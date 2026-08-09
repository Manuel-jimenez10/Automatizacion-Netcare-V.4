import { EspoCRMClient } from './espocrm-api-client.service';
import { sendDynamicTemplateMessage, getLastInboundMessageDate } from './twilio.service';
import { adminNotificationService } from './admin-notification.service';
import { env } from '../config/env';
import { EspoCRMQuote } from '../interfaces/interfaces';
import { extractAndValidatePhone } from '../utils/phone-utils';
import { phoneKey } from '../utils/notification-phone.utils';

/**
 * Ciclo de seguimiento de cotizaciones presentadas.
 *
 * ┌─ REGLA ───────────────────────────────────────────────────────────────┐
 * │ Cotización en 'Presented' + N días sin movimiento → se envía el       │
 * │ template de seguimiento y se suma 1 al contador de la Quote.          │
 * │                                                                       │
 * │   contador 0 → 1   primer seguimiento                                 │
 * │   contador 1 → 2   segundo seguimiento + aviso al administrador       │
 * │   contador 2       agotada: no se vuelve a enviar nunca               │
 * │                                                                       │
 * │ Si el cliente responde en cualquier momento, el ciclo se cierra       │
 * │ (el contador se lleva al máximo) y no recibe más seguimientos.        │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Antes de este cambio no existía contador: la única marca era la fecha del
 * último envío y se reiniciaba en cada envío, así que el cliente recibía un
 * template cada 7 días indefinidamente (~52 al año por cotización).
 */

/** Motivo por el que una cotización no recibió mensaje en esta corrida. */
export type QuoteFollowUpOutcome =
  | 'sent'
  | 'would_send'      // dry-run
  | 'waiting'         // aún no pasan los días
  | 'exhausted'       // contador al máximo
  | 'stopped_by_reply'
  | 'deferred'        // tope de la corrida
  | 'not_presented'   // cambió de estado mientras corría el proceso
  | 'error';

export interface QuoteFollowUpDetail {
  quoteId: string;
  quoteName: string;
  outcome: QuoteFollowUpOutcome;
  attempt?: number;
  reason?: string;
  /** El aviso al administrador se entregó de verdad (no solo se intentó). */
  adminNotified?: boolean;
}

export interface QuoteFollowUpRunResult {
  dryRun: boolean;
  totalPresented: number;
  sent: number;
  skipped: number;
  errors: number;
  stoppedByReply: number;
  adminNotified: number;
  deferred: number;
  details: QuoteFollowUpDetail[];
}

/**
 * El nombre del campo contador no coincide con ningún campo real de la Quote.
 * Es fatal: sin contador no hay tope, y seguir enviando reproduce el bucle
 * infinito que este módulo viene a eliminar.
 */
class CounterFieldMismatchError extends Error {}

/**
 * Códigos de Twilio que significan "a este destino no se le puede volver a
 * enviar": opt-out del usuario, marketing bloqueado por sus preferencias o
 * destino inválido. Insistir tras un opt-out es exactamente lo que degrada la
 * calidad del sender, así que el ciclo se cierra en el acto.
 */
const TERMINAL_SEND_ERROR_CODES = new Set([21610, 63049, 63003, 21211, 21614]);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Presupuesto de envíos del día, compartido por el cron y por todas las
 * llamadas manuales al endpoint. Sin él, repetir /run-followup vaciaría de
 * golpe todo el backlog que el tope por corrida acababa de diferir.
 */
const dailyBudget = { date: '', used: 0 };

const todayKey = () => new Date().toISOString().split('T')[0];

const consumeDailyBudget = (): number => {
  if (dailyBudget.date !== todayKey()) {
    dailyBudget.date = todayKey();
    dailyBudget.used = 0;
  }
  dailyBudget.used += 1;
  return dailyBudget.used;
};

const dailyBudgetUsed = (): number => (dailyBudget.date === todayKey() ? dailyBudget.used : 0);

/** 'YYYY-MM-DD HH:MM:SS' en UTC, el formato que espera EspoCRM. */
const toEspoDateTime = (date: Date): string =>
  date.toISOString().slice(0, 19).replace('T', ' ');

export interface QuoteFollowUpDependencies {
  espoCRMClient?: any;
  sendTemplate?: typeof sendDynamicTemplateMessage;
  lookupLastInbound?: typeof getLastInboundMessageDate;
  notifyExhausted?: (params: { quoteName: string; clientPhone: string }) => Promise<any>;
}

export class QuoteFollowUpService {
  private espoCRMClient: any;
  private sendTemplate: typeof sendDynamicTemplateMessage;
  private lookupLastInbound: typeof getLastInboundMessageDate;
  private notifyExhausted: (params: { quoteName: string; clientPhone: string }) => Promise<any>;

  /** Intentos de envío de esta corrida (exitosos o no) y destinatarios ya usados. */
  private attemptsThisRun = 0;
  private phonesThisRun = new Set<string>();

  constructor(deps: QuoteFollowUpDependencies = {}) {
    this.espoCRMClient = deps.espoCRMClient || new EspoCRMClient();
    this.sendTemplate = deps.sendTemplate || sendDynamicTemplateMessage;
    this.lookupLastInbound = deps.lookupLastInbound || getLastInboundMessageDate;
    this.notifyExhausted =
      deps.notifyExhausted ||
      (params => adminNotificationService.notifyQuoteFollowUpExhausted(params));
  }

  private get counterField(): string {
    return env.quoteFollowUpCounterField;
  }

  private get maxAttempts(): number {
    return env.quoteFollowUpMaxAttempts;
  }

  // ─────────────────────────────────────────────────────────────
  // Proceso principal
  // ─────────────────────────────────────────────────────────────

  async processQuoteFollowUps(options: { dryRun?: boolean } = {}): Promise<QuoteFollowUpRunResult> {
    const dryRun = options.dryRun ?? env.quoteFollowUpDryRun;

    const result: QuoteFollowUpRunResult = {
      dryRun,
      totalPresented: 0,
      sent: 0,
      skipped: 0,
      errors: 0,
      stoppedByReply: 0,
      adminNotified: 0,
      deferred: 0,
      details: [],
    };

    console.log('\n🚀 ============================================');
    console.log(`🚀 Seguimiento de cotizaciones${dryRun ? ' (SIMULACIÓN — no se envía nada)' : ''}`);
    console.log(`   Campo contador: ${this.counterField} | Máx. seguimientos: ${this.maxAttempts} | Cada ${env.quoteFollowUpDays} días`);
    console.log('🚀 ============================================\n');

    if (!env.quoteFollowUpEnabled) {
      console.log('ℹ️ QUOTE_FOLLOWUP_ENABLED=false. Proceso desactivado.');
      return result;
    }

    if (!env.quoteFollowUpTemplateSid && !dryRun) {
      throw new Error('QUOTE_FOLLOWUP_SID no está configurado: no hay template que enviar.');
    }

    const quotes = await this.fetchPresentedQuotes();
    result.totalPresented = quotes.length;

    if (quotes.length === 0) {
      console.log('ℹ️ No hay cotizaciones en estado Presented.');
      return result;
    }

    console.log(`\n📊 ${quotes.length} cotización(es) en Presented\n`);

    const maxPerRun = env.quoteFollowUpMaxPerRun;
    const maxPerDay = env.quoteFollowUpMaxPerDay;

    await this.assertCounterFieldExists(quotes[0]);

    this.attemptsThisRun = 0;
    this.phonesThisRun.clear();

    for (const quote of quotes) {
      // El tope cuenta INTENTOS, no éxitos: si Twilio empieza a fallar, contar
      // solo los éxitos convertiría la corrida en una ráfaga sin freno.
      // En simulación no se aplica: la gracia es ver la foto completa.
      if (!dryRun && maxPerRun > 0 && this.attemptsThisRun >= maxPerRun) {
        this.defer(result, quote, `tope de ${maxPerRun} envíos por corrida`);
        continue;
      }

      // Presupuesto diario compartido por el cron y por las llamadas manuales:
      // sin él, repetir /run-followup vaciaría de golpe todo el backlog que el
      // tope por corrida acababa de diferir.
      if (!dryRun && maxPerDay > 0 && dailyBudgetUsed() >= maxPerDay) {
        this.defer(result, quote, `presupuesto diario de ${maxPerDay} envíos agotado`);
        continue;
      }

      const attemptsBefore = this.attemptsThisRun;

      try {
        const detail = await this.processQuote(quote, dryRun);
        result.details.push(detail);

        switch (detail.outcome) {
          case 'sent':
          case 'would_send':
            result.sent++;
            if (detail.adminNotified) result.adminNotified++;
            break;
          case 'stopped_by_reply':
            result.stoppedByReply++;
            break;
          case 'deferred':
            result.deferred++;
            break;
          default:
            result.skipped++;
        }
      } catch (error: any) {
        if (error instanceof CounterFieldMismatchError) {
          console.error('\n🛑 ============================================');
          console.error(`🛑 ${error.message}`);
          console.error('🛑 Se ABORTA la corrida completa para no enviar sin control.');
          console.error('🛑 ============================================\n');
          throw error;
        }

        console.error(`❌ Error procesando "${quote.name}" (${quote.id}): ${error.message}`);
        result.errors++;
        result.details.push({
          quoteId: quote.id,
          quoteName: quote.name,
          outcome: 'error',
          reason: error.message,
        });
      }

      // Pausa tras CUALQUIER intento de envío, saliera bien o mal.
      if (!dryRun && this.attemptsThisRun > attemptsBefore && env.quoteFollowUpDelayMs > 0) {
        await sleep(env.quoteFollowUpDelayMs);
      }
    }

    this.printSummary(result);
    return result;
  }

  private defer(result: QuoteFollowUpRunResult, quote: any, reason: string): void {
    result.deferred++;
    result.details.push({
      quoteId: quote.id,
      quoteName: quote.name,
      outcome: 'deferred',
      reason,
    });
  }

  /**
   * Comprobación previa: el campo contador tiene que existir de verdad.
   *
   * EspoCRM ignora en silencio los atributos desconocidos, así que sin esto un
   * nombre mal escrito daría contador 0 en cada corrida y el tope no se
   * alcanzaría jamás. Se comprueba ANTES de enviar nada, y también en
   * simulación, que es donde se quiere detectar el problema.
   */
  private async assertCounterFieldExists(sampleQuote: any): Promise<void> {
    if (!sampleQuote) return;

    const quote = await this.espoCRMClient.getEntity('Quote', sampleQuote.id);

    if (!(this.counterField in quote)) {
      throw new CounterFieldMismatchError(
        `El campo "${this.counterField}" no existe en Quote (EspoCRM no lo devuelve al leer ` +
          `la cotización ${sampleQuote.id}). Comprueba el nombre interno en Entity Manager → ` +
          `Quote y ajústalo con QUOTE_FOLLOWUP_COUNTER_FIELD. Candidato alternativo: "seguimientoCotizacin".`,
      );
    }

    console.log(`   ✔ Campo contador "${this.counterField}" verificado en EspoCRM`);
  }

  /** Descarga TODAS las Quotes en Presented, paginando. */
  private async fetchPresentedQuotes(): Promise<EspoCRMQuote[]> {
    const where = [
      {
        type: 'and',
        value: [{ type: 'equals', attribute: 'status', value: 'Presented' }],
      },
    ];

    const pageSize = 200;
    const all: EspoCRMQuote[] = [];
    let offset = 0;

    // Cota de seguridad: 25 páginas = 5.000 cotizaciones.
    for (let page = 0; page < 25; page++) {
      const { list, total } = await this.espoCRMClient.searchEntitiesPaged('Quote', where, {
        maxSize: pageSize,
        offset,
      });

      all.push(...list);
      offset += list.length;

      if (list.length === 0 || all.length >= total) break;
    }

    return all;
  }

  // ─────────────────────────────────────────────────────────────
  // Una cotización
  // ─────────────────────────────────────────────────────────────

  private async processQuote(listQuote: any, dryRun: boolean): Promise<QuoteFollowUpDetail> {
    const base: QuoteFollowUpDetail = { quoteId: listQuote.id, quoteName: listQuote.name, outcome: 'waiting' };

    // 1. Filtros baratos con los datos del listado, para no gastar llamadas.
    const listCounter = this.readCounter(listQuote);
    if (listCounter >= this.maxAttempts) {
      return { ...base, outcome: 'exhausted', attempt: listCounter };
    }

    const daysElapsed = this.daysSinceReference(listQuote);
    if (daysElapsed < env.quoteFollowUpDays) {
      return { ...base, outcome: 'waiting', reason: `${daysElapsed}/${env.quoteFollowUpDays} días` };
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 "${listQuote.name}" (${listQuote.id}) — ${daysElapsed} días desde el último movimiento`);

    // 2. Releer la cotización: el listado puede traer datos obsoletos (el
    //    proceso tarda minutos) y puede no incluir el campo custom.
    const quote = await this.espoCRMClient.getEntity('Quote', listQuote.id);

    if (quote.status !== 'Presented') {
      console.log(`   ↪ Ya no está en Presented (${quote.status}). Se omite.`);
      return { ...base, outcome: 'not_presented', reason: quote.status };
    }

    const counter = this.readCounter(quote);
    if (counter >= this.maxAttempts) {
      console.log(`   ↪ Contador ya en ${counter}. Seguimiento agotado.`);
      return { ...base, outcome: 'exhausted', attempt: counter };
    }

    if (this.daysSinceReference(quote) < env.quoteFollowUpDays) {
      return { ...base, outcome: 'waiting', reason: 'otra corrida ya la atendió' };
    }

    // 3. Destinatario
    if (!quote.billingContactId) {
      throw new Error('sin Contacto de Facturación (Billing Contact)');
    }

    const contact = await this.espoCRMClient.getContact(quote.billingContactId);
    const phoneValidation = extractAndValidatePhone(contact);

    if (!phoneValidation.isValid) {
      throw new Error(`el contacto "${contact.name}" no tiene teléfono válido: ${phoneValidation.error}`);
    }

    const phone = phoneValidation.formattedNumber!;
    const clientName = contact.name || contact.firstName || 'Cliente';
    console.log(`   👤 ${clientName} — ${phone}`);

    // Un cliente con varias cotizaciones abiertas recibiría N templates
    // seguidos. Se le manda uno por corrida y las demás esperan a mañana.
    const recipientKey = phoneKey(phone);
    if (!dryRun && this.phonesThisRun.has(recipientKey)) {
      console.log('   ↪ Ya se le envió un seguimiento a este cliente en esta corrida. Se difiere.');
      return { ...base, outcome: 'deferred', reason: 'un seguimiento por cliente y corrida' };
    }

    // 4. ¿Ya nos contestó? Se comprueba SIEMPRE, también antes del primer
    //    seguimiento: cuando la cotización pasó a Presented ya se le envió un
    //    WhatsApp (quote-presented.service), así que su respuesta a aquel
    //    mensaje también cuenta. La regla es "si responde, se deja de
    //    perseguir", sin excepciones.
    const replied = await this.clientHasReplied(quote, phone, contact.id);
    if (replied) {
      console.log('   ✋ El cliente respondió. Se cierra el seguimiento sin enviar.');
      if (!dryRun) {
        await this.writeCounter(quote.id, this.maxAttempts);
      }
      return { ...base, outcome: 'stopped_by_reply', attempt: counter };
    }

    const attempt = counter + 1;

    if (dryRun) {
      console.log(`   🧪 SIMULACIÓN: se enviaría el seguimiento #${attempt}`);
      return { ...base, outcome: 'would_send', attempt };
    }

    // 5. RESERVAR antes de enviar. Si se enviara primero y este PUT fallara
    //    (los 520 de Cloudflare ya han pasado en este CRM), mañana se
    //    reenviaría el mismo template, y pasado también: bucle infinito.
    //    Perder un seguimiento es barato; repetirlo no.
    await this.reserveAttempt(quote.id, attempt);

    this.attemptsThisRun++;
    this.phonesThisRun.add(recipientKey);
    const usedToday = consumeDailyBudget();

    // 6. Enviar al cliente
    console.log(`   📱 Enviando seguimiento #${attempt}/${this.maxAttempts}... (envío ${usedToday} del día)`);

    let twilioResponse: any;
    try {
      twilioResponse = await this.sendTemplate({
        phone,
        contentSid: env.quoteFollowUpTemplateSid,
        contentVariables: { '1': clientName, '2': quote.name },
      });
    } catch (sendError: any) {
      await this.closeCycleOnTerminalError(quote.id, sendError?.code, attempt);
      throw sendError;
    }

    // Twilio puede aceptar la petición y devolver el rechazo en el propio
    // recurso. Si el destino ya no admite este mensaje (opt-out, marketing
    // bloqueado, número inválido), no debe haber un segundo intento.
    if (twilioResponse?.errorCode) {
      await this.closeCycleOnTerminalError(quote.id, twilioResponse.errorCode, attempt);
    }

    await this.logMessageInEspo(quote, phone, twilioResponse, attempt);

    // 7. Último seguimiento → avisar al administrador
    let adminNotified = false;
    if (attempt >= this.maxAttempts) {
      try {
        const notifyResult = await this.notifyExhausted({
          quoteName: quote.name,
          clientPhone: phone,
        });
        adminNotified = !!notifyResult?.notified;
        if (!adminNotified) {
          console.warn(
            `   ⚠️ El aviso al administrador NO se entregó (${notifyResult?.reason || 'sin detalle'})`,
          );
        }
      } catch (notifyError: any) {
        console.error(`   ⚠️ El seguimiento salió, pero falló el aviso al administrador: ${notifyError.message}`);
      }
    }

    console.log(`   ✅ Seguimiento #${attempt} completado`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return { ...base, outcome: 'sent', attempt, adminNotified };
  }

  /**
   * Cierra el ciclo cuando Twilio dice que a ese destino no se le puede volver
   * a enviar. Nunca lanza: el objetivo es no dejar la puerta abierta a un
   * segundo intento, no complicar el manejo del error original.
   */
  private async closeCycleOnTerminalError(
    quoteId: string,
    errorCode: any,
    attempt: number,
  ): Promise<void> {
    if (!TERMINAL_SEND_ERROR_CODES.has(Number(errorCode))) return;
    if (attempt >= this.maxAttempts) return;

    console.warn(
      `   🛑 Twilio devolvió ${errorCode} (destino no admite este mensaje). Se cierra el ciclo para no insistir.`,
    );

    try {
      await this.writeCounter(quoteId, this.maxAttempts);
    } catch (error: any) {
      console.error(`   ⚠️ No se pudo cerrar el ciclo tras el error ${errorCode}: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Contador
  // ─────────────────────────────────────────────────────────────

  private readCounter(quote: any): number {
    const raw = quote?.[this.counterField];
    if (raw === null || raw === undefined || raw === '') return 0;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  /**
   * Escribe el contador y comprueba que EspoCRM lo aceptó de verdad.
   *
   * EspoCRM ignora en silencio los atributos desconocidos y responde 200, así
   * que un PUT correcto NO demuestra que el nombre del campo exista. Sin esta
   * comprobación, un nombre mal escrito daría un contador siempre a 0 y el
   * tope no se alcanzaría jamás.
   */
  private async writeCounter(quoteId: string, value: number, extra: Record<string, any> = {}): Promise<void> {
    const payload = { [this.counterField]: value, ...extra };
    let updated = await this.espoCRMClient.updateEntity('Quote', quoteId, payload);

    // Algunas configuraciones de EspoCRM responden al PUT con un cuerpo vacío
    // o parcial. En ese caso se relee la entidad antes de dar por hecho que el
    // campo no existe: abortar la corrida por una respuesta escueta sería peor.
    if (!updated || typeof updated !== 'object' || !(this.counterField in updated)) {
      updated = await this.espoCRMClient.getEntity('Quote', quoteId);
    }

    const stored = updated ? Number(updated[this.counterField]) : NaN;
    if (stored !== value) {
      throw new CounterFieldMismatchError(
        `El campo "${this.counterField}" no existe en Quote o no se pudo escribir ` +
          `(se envió ${value}, EspoCRM devolvió ${JSON.stringify(updated?.[this.counterField])}). ` +
          `Comprueba el nombre interno en Entity Manager → Quote y ajústalo con ` +
          `QUOTE_FOLLOWUP_COUNTER_FIELD. Candidato alternativo: "seguimientoCotizacin".`,
      );
    }
  }

  /** Reserva el intento: contador y fecha en un ÚNICO PUT, para no dejar estados a medias. */
  private async reserveAttempt(quoteId: string, attempt: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    await this.writeCounter(quoteId, attempt, { cotizacinEnviadaPorWhatsapp: today });
    console.log(`   🔒 Intento #${attempt} reservado (contador y fecha actualizados)`);
  }

  // ─────────────────────────────────────────────────────────────
  // ¿Respondió el cliente?
  // ─────────────────────────────────────────────────────────────

  /**
   * Dos fuentes independientes, y basta con que una vea la respuesta.
   *
   * Se prefiere sobre-detectar: un falso positivo solo nos ahorra un
   * seguimiento, mientras que un falso negativo manda un segundo template a
   * alguien que ya nos está hablando.
   */
  private async clientHasReplied(quote: any, phone: string, contactId?: string): Promise<boolean> {
    const since = this.lastFollowUpDate(quote);
    console.log(`   🔎 Buscando respuestas del cliente desde ${since.toISOString()}...`);

    const crm = await this.hasInboundInCrm(phone, contactId, since);
    if (crm === true) {
      console.log('      ↪ Respuesta encontrada en EspoCRM');
      return true;
    }

    let twilio: boolean | 'unknown' = 'unknown';
    if (env.quoteFollowUpCheckTwilio) {
      twilio = await this.hasInboundInTwilio(phone, since);
      if (twilio === true) {
        console.log('      ↪ Respuesta encontrada en el historial de Twilio');
        return true;
      }
    }

    // Si NINGUNA fuente pudo responder, no sabemos nada. Enviar en ese estado
    // es el peor error posible (insistir a quien ya nos habló), así que se
    // aborta esta cotización: mañana se reintenta y el contador sigue intacto.
    const crmFailed = crm === 'unknown';
    const twilioUnavailable = !env.quoteFollowUpCheckTwilio || twilio === 'unknown';
    if (crmFailed && twilioUnavailable) {
      throw new Error(
        'no se pudo comprobar si el cliente respondió (EspoCRM y Twilio no respondieron). Se pospone al próximo día.',
      );
    }

    console.log('      ↪ Sin respuestas');
    return false;
  }

  private async hasInboundInCrm(
    phone: string,
    contactId: string | undefined,
    since: Date,
  ): Promise<boolean | 'unknown'> {
    try {
      const digits = phone.replace(/\D/g, '');
      const last8 = digits.slice(-8);

      const messages = await this.espoCRMClient.searchEntities('WhatsappMessage', [
        {
          type: 'and',
          value: [
            { type: 'equals', attribute: 'type', value: 'In' },
            { type: 'after', attribute: 'createdAt', value: toEspoDateTime(since) },
            { type: 'contains', attribute: 'name', value: last8 },
          ],
        },
      ]);

      // El campo `name` llega con formatos distintos según el origen (en México
      // el entrante trae el "1" y el saliente no), así que se confirma con la
      // clave canónica en vez de fiarse del texto.
      return messages.some((m: any) => {
        if (contactId && m.contactId === contactId) return true;
        return phoneKey(m.name || '') === phoneKey(phone);
      });
    } catch (error: any) {
      console.warn(`      ⚠️ No se pudo consultar EspoCRM: ${error.message}`);
      return 'unknown';
    }
  }

  private async hasInboundInTwilio(phone: string, since: Date): Promise<boolean | 'unknown'> {
    try {
      const hours = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 3600000));
      const lastInbound = await this.lookupLastInbound(phone, hours);
      return !!lastInbound && lastInbound >= since;
    } catch (error: any) {
      console.warn(`      ⚠️ No se pudo consultar Twilio: ${error.message}`);
      return 'unknown';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Fechas
  // ─────────────────────────────────────────────────────────────

  /** Fecha de referencia: último WhatsApp enviado > presentación > creación. */
  private referenceDate(quote: any): { date: Date; label: string } {
    // `modifiedAt` va antes que `createdAt`: una cotización creada hace un año
    // y presentada ayer no debe considerarse "lleva un año esperando".
    const candidates: Array<[string | undefined, string]> = [
      [quote.cotizacinEnviadaPorWhatsapp, 'último WhatsApp enviado'],
      [quote.datePresented, 'fecha de presentación'],
      [quote.modifiedAt, 'última modificación'],
      [quote.createdAt, 'fecha de creación'],
    ];

    for (const [value, label] of candidates) {
      if (!value) continue;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return { date: parsed, label };
    }

    // Sin ninguna fecha usable la tratamos como recién creada: es preferible
    // no enviar a enviar por error.
    return { date: new Date(), label: 'sin fecha válida' };
  }

  private lastFollowUpDate(quote: any): Date {
    return this.referenceDate(quote).date;
  }

  private daysSinceReference(quote: any): number {
    const { date } = this.referenceDate(quote);
    return Math.floor((Date.now() - date.getTime()) / 86400000);
  }

  // ─────────────────────────────────────────────────────────────
  // Registro y resumen
  // ─────────────────────────────────────────────────────────────

  private async logMessageInEspo(
    quote: any,
    phone: string,
    twilioResponse: any,
    attempt: number,
  ): Promise<void> {
    try {
      const messagePayload: any = {
        name: phone,
        contact: phone,
        status: 'Sent',
        type: 'Out',
        description: twilioResponse.body || `Seguimiento #${attempt} de cotización: ${quote.name}`,
        messageSid: twilioResponse.sid,
        isRead: false,
        quoteId: quote.id,
        quoteName: quote.name,
      };

      if (quote.billingContactId) messagePayload.contactId = quote.billingContactId;

      await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
      console.log(`   💾 Registrado en WhatsappMessage (SID ${twilioResponse.sid})`);
    } catch (error: any) {
      // El mensaje ya salió: no lo convertimos en error de la cotización.
      console.error(`   ⚠️ No se pudo registrar en WhatsappMessage: ${error.message}`);
    }
  }

  private printSummary(result: QuoteFollowUpRunResult): void {
    console.log('\n📊 ============================================');
    console.log(`📊 RESUMEN${result.dryRun ? ' (SIMULACIÓN)' : ''}`);
    console.log('📊 ============================================');
    console.log(`   Cotizaciones en Presented: ${result.totalPresented}`);
    console.log(`   ✅ ${result.dryRun ? 'Se enviarían' : 'Enviados'}: ${result.sent}`);
    console.log(`   🔔 Avisos al administrador: ${result.adminNotified}`);
    console.log(`   ✋ Cerradas porque el cliente respondió: ${result.stoppedByReply}`);
    console.log(`   ⏳ Sin acción: ${result.skipped}`);
    console.log(`   📦 Diferidas al próximo día (tope de corrida): ${result.deferred}`);
    console.log(`   ❌ Con errores: ${result.errors}`);

    const failed = result.details.filter(d => d.outcome === 'error');
    if (failed.length > 0) {
      console.log('\n   Cotizaciones con error:');
      failed.forEach(d => console.log(`     - ${d.quoteName} (${d.quoteId}): ${d.reason}`));
    }
    console.log('📊 ============================================\n');
  }
}
