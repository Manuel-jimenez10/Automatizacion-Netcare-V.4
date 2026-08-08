/**
 * Notificaciones a administradores por cada mensaje entrante de un cliente.
 *
 * ┌─ FLUJO ───────────────────────────────────────────────────────────────┐
 * │ 1. Llega un mensaje de un CLIENTE (webhook de Twilio o workflow del   │
 * │    CRM).                                                              │
 * │ 2. Para cada administrador configurado:                               │
 * │      • Ventana de 24h CERRADA → se envía el TEMPLATE aprobado.        │
 * │      • Ventana de 24h ABIERTA → se envía TEXTO PLANO con el mismo     │
 * │        formato, así el template no se quema ante Meta.                │
 * │ 3. Cuando el administrador responde (cualquier mensaje suyo), su      │
 * │    ventana se abre y se reinicia a 24h desde ese instante.            │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Nada de esto se registra en EspoCRM: son avisos internos y ensuciarían las
 * conversaciones de los clientes.
 *
 * NOTA DE DESPLIEGUE: el estado vive en el proceso (+ un JSON en disco). Está
 * pensado para UNA sola instancia. Con varias instancias las ventanas divergen
 * y la deduplicación deja de ser fiable.
 */

import { env } from '../config/env';
import {
  sendTextMessage,
  sendDynamicTemplateMessage,
  getLastInboundMessageDate,
} from './twilio.service';
import { AdminNotificationSessionStore } from './admin-notification-session.store';
import {
  isSamePhone,
  maskPhone,
  parsePhoneList,
  phoneKey,
  phoneVariants,
  sanitizeTemplateVariable,
} from '../utils/notification-phone.utils';

/** Códigos de Twilio que significan "estás fuera de la ventana de 24h". */
const OUTSIDE_WINDOW_ERROR_CODES = new Set([63016]);

/**
 * Códigos que significan "Meta/Twilio nos está frenando". Insistir empeora la
 * calidad del sender, así que se pausa el template para ese administrador.
 * 63018 = demasiados mensajes al mismo destinatario
 * 63049 = template de marketing bloqueado por preferencias del usuario
 * 63051 = sender bloqueado (el incidente de julio 2026)
 * 429   = rate limit de la API
 */
const THROTTLE_ERROR_CODES = new Set([63018, 63049, 63051, 429]);
const THROTTLE_BACKOFF_MS = 60 * 60 * 1000; // 1 hora

/** Códigos que sugieren que el número de destino no es válido tal cual. */
const INVALID_DESTINATION_ERROR_CODES = new Set([21211, 21614, 63003]);

// Candado entre disparadores. Debe superar con holgura lo que tarda un
// fan-out completo (rehidratación + envíos), o el otro disparador entraría
// mientras el primero sigue en vuelo y llegaría un aviso duplicado.
const INFLIGHT_TTL_MS = 5 * 60 * 1000;
const DEDUPE_TTL_MS = 15 * 60 * 1000;       // notificado con éxito
const SENT_SID_TTL_MS = 24 * 60 * 60 * 1000;

export interface NewClientMessage {
  /** Teléfono del cliente que escribió (variable {{1}}). */
  fromPhone: string;
  /** Contenido del mensaje (variable {{2}}). */
  body: string;
  /** MessageSid o ID de entidad, para no notificar dos veces lo mismo. */
  dedupeKey?: string;
  /** De dónde vino el disparo, solo para logs. */
  source?: string;
}

export type DeliveryChannel = 'template' | 'text';

export interface AdminDeliveryResult {
  phone: string;
  channel: DeliveryChannel | null;
  sid?: string;
  skipped?: string;
  error?: string;
}

export interface NotificationResult {
  notified: boolean;
  reason?: string;
  from?: string;
  preview?: string;
  deliveries: AdminDeliveryResult[];
}

interface Dependencies {
  sendText?: typeof sendTextMessage;
  sendTemplate?: typeof sendDynamicTemplateMessage;
  lookupLastInbound?: typeof getLastInboundMessageDate;
  store?: AdminNotificationSessionStore;
  phones?: string;
}

export class AdminNotificationService {
  private readonly store: AdminNotificationSessionStore;
  private readonly sendText: typeof sendTextMessage;
  private readonly sendTemplate: typeof sendDynamicTemplateMessage;
  private readonly lookupLastInbound: typeof getLastInboundMessageDate;
  private readonly admins: string[];

  /** dedupeKey → epoch ms de una notificación ya entregada. */
  private readonly deliveredKeys = new Map<string, number>();
  /** dedupeKey → epoch ms de una notificación en curso (candado corto). */
  private readonly inflightKeys = new Map<string, number>();
  /** SID de notificación → { admin destinatario, momento del envío }. */
  private readonly notificationSids = new Map<string, { phone: string; at: number }>();
  /** Rehidratación desde Twilio: una sola consulta por admin y por proceso. */
  private readonly rehydrated = new Map<string, Promise<void>>();
  /** Variante de número que Twilio aceptó (México: con o sin el "1"). */
  private readonly workingDestination = new Map<string, string>();

  constructor(deps: Dependencies = {}) {
    this.sendText = deps.sendText || sendTextMessage;
    this.sendTemplate = deps.sendTemplate || sendDynamicTemplateMessage;
    this.lookupLastInbound = deps.lookupLastInbound || getLastInboundMessageDate;
    this.admins = parsePhoneList(deps.phones ?? env.adminNotificationPhones);
    this.store =
      deps.store ||
      new AdminNotificationSessionStore({
        filePath: env.adminNotificationStateFile || undefined,
        windowHours: env.adminNotificationWindowHours,
      });
  }

  // ─────────────────────────────────────────────────────────────
  // Consultas
  // ─────────────────────────────────────────────────────────────

  /** Lista de administradores configurados (E.164). */
  getAdmins(): string[] {
    return [...this.admins];
  }

  /**
   * ¿Este teléfono es uno de los administradores?
   *
   * Con la función apagada devuelve siempre false: `ADMIN_NOTIFICATION_ENABLED=false`
   * tiene que restaurar el comportamiento anterior por completo, incluido que
   * los mensajes de esos números vuelvan a registrarse en EspoCRM.
   */
  isAdminPhone(phone: string): boolean {
    if (!phone || !env.adminNotificationEnabled) return false;
    return this.admins.some(admin => isSamePhone(admin, phone));
  }

  /** ¿Este SID corresponde a una notificación interna? */
  isNotificationSid(sid: string): boolean {
    if (!sid) return false;
    this.pruneSids();
    return this.notificationSids.has(sid);
  }

  /**
   * Un status callback nos trajo un error de entrega.
   *
   * Es la vía por la que llegan de verdad los 63018/63049/63051: `messages.create`
   * casi siempre responde `queued` y el rechazo de Meta aparece después. Sin
   * esto, el backoff nunca se activaría en producción.
   */
  handleDeliveryFailure(sid: string, errorCode: any): void {
    if (!sid || !THROTTLE_ERROR_CODES.has(Number(errorCode))) return;

    this.pruneSids();
    const entry = this.notificationSids.get(sid);
    if (!entry) return;

    this.store.setBackoff(entry.phone, THROTTLE_BACKOFF_MS);
    console.error(
      `   🚨 [Notif Admin] Meta/Twilio rechazó ${sid} (${errorCode}) para ${maskPhone(entry.phone)}. Sin avisos durante 1 hora.`,
    );
  }

  /**
   * Estado de las ventanas. Los teléfonos van enmascarados salvo que se pida
   * lo contrario explícitamente (son datos personales).
   */
  getStatus(options: { revealPhones?: boolean } = {}) {
    return {
      enabled: env.adminNotificationEnabled,
      templateConfigured: !!env.adminNotificationTemplateSid,
      windowHours: env.adminNotificationWindowHours,
      templateCooldownMinutes: env.adminNotificationTemplateCooldownMinutes,
      maxTemplatesPerHour: env.adminNotificationMaxTemplatesPerHour,
      admins: this.admins.map(phone => {
        const session = this.store.get(phone);
        const remainingMs = this.store.remainingMs(phone);
        const backoffMs = this.store.backoffRemainingMs(phone);
        return {
          phone: options.revealPhones ? phone : maskPhone(phone),
          windowOpen: remainingMs > 0,
          remainingMinutes: Math.round(remainingMs / 60000),
          lastInboundAt: session.lastInboundAt
            ? new Date(session.lastInboundAt).toISOString()
            : null,
          nextChannel: remainingMs > 0 ? 'text' : 'template',
          templatesLastHour: this.store.templatesInLastHour(phone),
          backoffMinutes: Math.round(backoffMs / 60000),
          templatesSent: session.templatesSent,
          freeTextSent: session.freeTextSent,
        };
      }),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Ventana de 24 horas
  // ─────────────────────────────────────────────────────────────

  /**
   * Registra un mensaje entrante de un administrador: abre/reinicia su
   * ventana de 24h. Cada mensaje suyo alarga la vida útil del template.
   */
  registerAdminReply(phone: string, body?: string): void {
    const admin = this.admins.find(a => isSamePhone(a, phone)) || phone;
    this.store.registerInbound(admin);

    // La rehidratación ya no aporta nada: tenemos un dato más fresco.
    this.rehydrated.set(phoneKey(admin), Promise.resolve());

    const remainingHours = (this.store.remainingMs(admin) / 3600000).toFixed(1);
    console.log(
      `🔓 [Notif Admin] Ventana de 24h ABIERTA/REINICIADA para ${maskPhone(admin)} (quedan ~${remainingHours}h)` +
        (body ? ` — respondió: "${sanitizeTemplateVariable(body, 80)}"` : ' — sin texto (reacción o adjunto)'),
    );
  }

  /** Limpia el estado de ventanas (mantenimiento / pruebas). */
  resetWindows(phone?: string): void {
    this.store.reset(phone);
    if (phone) this.rehydrated.delete(phoneKey(phone));
    else this.rehydrated.clear();
  }

  /**
   * Tras un reinicio del proceso podemos haber perdido la ventana. Antes de
   * decidir el canal, preguntamos UNA vez a Twilio si ese administrador nos
   * escribió en las últimas horas.
   */
  private async ensureRehydrated(admin: string): Promise<void> {
    if (!env.adminNotificationRehydrate) return;

    const key = phoneKey(admin);

    // Si ya sabemos que la ventana está abierta, no hay nada que reconstruir.
    if (this.store.remainingMs(admin) > 0) {
      this.rehydrated.set(key, Promise.resolve());
      return;
    }

    let pending = this.rehydrated.get(key);

    if (!pending) {
      pending = (async () => {
        try {
          const lastInbound = await this.lookupLastInbound(
            admin,
            env.adminNotificationWindowHours,
          );
          if (lastInbound) {
            this.store.registerInbound(admin, lastInbound.getTime());
            console.log(
              `♻️ [Notif Admin] Ventana rehidratada desde Twilio para ${maskPhone(admin)} (último mensaje suyo: ${lastInbound.toISOString()})`,
            );
          }
        } catch (error: any) {
          // No cacheamos el fallo: si no, un 429 puntual dejaría la
          // rehidratación desactivada para todo el proceso.
          this.rehydrated.delete(key);
          console.warn(
            `⚠️ [Notif Admin] Rehidratación fallida para ${maskPhone(admin)} (se reintentará): ${error.message}`,
          );
        }
      })();

      this.rehydrated.set(key, pending);
    }

    await pending;
  }

  // ─────────────────────────────────────────────────────────────
  // Envío
  // ─────────────────────────────────────────────────────────────

  /** Texto final que ve el administrador (idéntico por ambos canales). */
  buildNotificationText(fromPhone: string, body: string): string {
    return env.adminNotificationTextFormat
      .replace(/\{\{\s*1\s*\}\}/g, fromPhone)
      .replace(/\{\{\s*2\s*\}\}/g, body);
  }

  /**
   * Punto de entrada principal. Nunca lanza: un fallo notificando no debe
   * romper el procesamiento del mensaje del cliente.
   */
  async notifyNewClientMessage(message: NewClientMessage): Promise<NotificationResult> {
    const deliveries: AdminDeliveryResult[] = [];

    if (!env.adminNotificationEnabled) {
      return { notified: false, reason: 'disabled', deliveries };
    }

    if (this.admins.length === 0) {
      console.warn('⚠️ [Notif Admin] No hay administradores configurados (ADMIN_NOTIFICATION_PHONES)');
      return { notified: false, reason: 'no_admins', deliveries };
    }

    if (!message.fromPhone) {
      return { notified: false, reason: 'missing_from', deliveries };
    }

    // Blindaje anti-bucle: un mensaje de un administrador jamás genera avisos.
    if (this.isAdminPhone(message.fromPhone)) {
      return { notified: false, reason: 'sender_is_admin', deliveries };
    }

    const key = message.dedupeKey;
    if (key && !this.claimKey(key)) {
      console.log(`↪ [Notif Admin] Mensaje ${key} ya notificado (o en curso). Se omite.`);
      return { notified: false, reason: 'duplicate', deliveries };
    }

    const fromVar = sanitizeTemplateVariable(message.fromPhone, 40);
    const bodyVar = sanitizeTemplateVariable(message.body, env.adminNotificationMaxBodyChars);
    const text = this.buildNotificationText(fromVar, bodyVar);

    console.log('\n🔔 ============================================');
    console.log(`🔔 Notificando mensaje nuevo de ${fromVar} a ${this.admins.length} administrador(es)`);
    console.log(`   Origen: ${message.source || 'desconocido'} | SID/ID: ${key || 'n/a'}`);
    console.log('🔔 ============================================');

    const settled = await Promise.allSettled(
      this.admins.map(admin => this.deliverToAdmin(admin, fromVar, bodyVar, text)),
    );

    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      deliveries.push(
        outcome.status === 'fulfilled'
          ? outcome.value
          : { phone: this.admins[i], channel: null, error: String(outcome.reason) },
      );
    }

    const ok = deliveries.filter(d => d.sid).length;
    console.log(`🔔 [Notif Admin] Resultado: ${ok}/${deliveries.length} entregado(s)\n`);

    // Solo bloqueamos futuros reintentos si el aviso salió de verdad. Si todo
    // falló, dejamos que el otro disparador (Twilio o el CRM) lo reintente.
    if (key) this.releaseKey(key, ok > 0);

    return {
      notified: ok > 0,
      from: fromVar,
      preview: text,
      deliveries,
    };
  }

  private async deliverToAdmin(
    admin: string,
    fromVar: string,
    bodyVar: string,
    text: string,
  ): Promise<AdminDeliveryResult> {
    try {
      await this.ensureRehydrated(admin);

      // El backoff se aplica a AMBOS canales: si Meta o Twilio nos frenaron,
      // insistir por texto libre degrada el sender igual que por template.
      const backoffMs = this.store.backoffRemainingMs(admin);
      if (backoffMs > 0) {
        console.warn(
          `   ⏸️ [Notif Admin] Avisos a ${maskPhone(admin)} en pausa ${Math.ceil(backoffMs / 60000)} min (Meta/Twilio nos frenó)`,
        );
        return { phone: admin, channel: null, skipped: 'throttle_backoff' };
      }

      if (this.store.remainingMs(admin) > 0) {
        try {
          return await this.sendFreeText(admin, text);
        } catch (error: any) {
          if (!this.isOutsideWindowError(error)) throw error;

          console.warn(
            `⚠️ [Notif Admin] Twilio reporta ventana cerrada para ${maskPhone(admin)} (${error.code}). Se reintenta con template.`,
          );
          this.store.closeWindow(admin);
        }
      }

      return await this.sendTemplateNotification(admin, fromVar, bodyVar);
    } catch (error: any) {
      if (THROTTLE_ERROR_CODES.has(Number(error?.code))) {
        this.store.setBackoff(admin, THROTTLE_BACKOFF_MS);
        console.error(
          `   🚨 [Notif Admin] Meta/Twilio nos frenó (${error.code}) para ${maskPhone(admin)}. Sin templates durante 1 hora.`,
        );
      }

      console.error(`   ❌ [Notif Admin] Falló el envío a ${maskPhone(admin)}: ${error.message}`);
      if (error.code) console.error(`      Código Twilio: ${error.code}`);
      return { phone: admin, channel: null, error: error.message };
    }
  }

  private async sendFreeText(admin: string, text: string): Promise<AdminDeliveryResult> {
    const message = await this.withDestinationFallback(admin, to =>
      this.sendText({ phone: to, text, statusCallback: this.statusCallbackUrl() }),
    );

    this.store.markFreeTextSent(admin);
    this.trackSid(message?.sid, admin);

    const remainingHours = (this.store.remainingMs(admin) / 3600000).toFixed(1);
    console.log(
      `   ✅ [Notif Admin] Texto plano a ${maskPhone(admin)} (ventana abierta, quedan ~${remainingHours}h) — SID: ${message?.sid}`,
    );

    return { phone: admin, channel: 'text', sid: message?.sid };
  }

  private async sendTemplateNotification(
    admin: string,
    fromVar: string,
    bodyVar: string,
  ): Promise<AdminDeliveryResult> {
    if (!env.adminNotificationTemplateSid) {
      const reason = 'ADMIN_NOTIFICATION_TEMPLATE_SID no configurado';
      console.warn(`   ⚠️ [Notif Admin] ${reason}`);
      return { phone: admin, channel: null, skipped: reason };
    }

    // El cupo se reserva ANTES del await: comprobar aquí e incrementar después
    // dejaría pasar toda una ráfaga concurrente sin que ningún envío viera a
    // los demás (que es justo el patrón que quemó el sender en julio 2026).
    const slot = this.store.reserveTemplateSlot(admin, {
      cooldownMs: env.adminNotificationTemplateCooldownMinutes * 60 * 1000,
      maxPerHour: env.adminNotificationMaxTemplatesPerHour,
    });

    if (!slot.allowed) {
      const detail = slot.retryInMinutes ? ` (faltan ${slot.retryInMinutes} min)` : '';
      console.warn(
        `   🛑 [Notif Admin] Template a ${maskPhone(admin)} omitido: ${slot.reason}${detail}`,
      );
      return { phone: admin, channel: null, skipped: slot.reason };
    }

    let message;
    try {
      message = await this.withDestinationFallback(admin, to =>
        this.sendTemplate({
          phone: to,
          contentSid: env.adminNotificationTemplateSid,
          contentVariables: { '1': fromVar, '2': bodyVar },
          statusCallback: this.statusCallbackUrl(),
        }),
      );
    } catch (error) {
      // No consumimos cupo por un mensaje que nunca salió.
      this.store.releaseTemplateSlot(admin, slot.timestamp);
      throw error;
    }

    this.trackSid(message?.sid, admin);

    console.log(
      `   ✅ [Notif Admin] Template a ${maskPhone(admin)} (ventana cerrada) — SID: ${message?.sid}`,
    );

    return { phone: admin, channel: 'template', sid: message?.sid };
  }

  // ─────────────────────────────────────────────────────────────
  // Auxiliares
  // ─────────────────────────────────────────────────────────────

  /**
   * México acepta el número con o sin el "1" tras el +52 según cómo esté dado
   * de alta en WhatsApp. Si Twilio rechaza el destino, reintentamos una vez
   * con la otra variante y recordamos cuál funcionó.
   */
  private async withDestinationFallback<T>(
    admin: string,
    send: (destination: string) => Promise<T>,
  ): Promise<T> {
    const key = phoneKey(admin);
    const preferred = this.workingDestination.get(key) || admin;

    try {
      const result = await send(preferred);
      this.workingDestination.set(key, preferred);
      return result;
    } catch (error: any) {
      if (!INVALID_DESTINATION_ERROR_CODES.has(Number(error?.code))) throw error;

      const alternate = phoneVariants(admin).find(v => v !== preferred);
      if (!alternate) throw error;

      console.warn(
        `   ↻ [Notif Admin] Destino rechazado (${error.code}). Reintentando ${maskPhone(admin)} con la variante alterna.`,
      );

      const result = await send(alternate);
      this.workingDestination.set(key, alternate);
      return result;
    }
  }

  /**
   * Callback dedicado para las notificaciones: así sus eventos de estado no
   * entran al handler que busca el SID en EspoCRM (no existe allí) ni siquiera
   * después de un reinicio, cuando el mapa en memoria está vacío.
   */
  private statusCallbackUrl(): string | undefined {
    const base = (env.publicUrl || '').trim();
    if (!base.startsWith('https://')) return undefined;
    return `${base.replace(/\/$/, '')}/api/admin-notifications/status-callback`;
  }

  private isOutsideWindowError(error: any): boolean {
    if (!error) return false;
    if (OUTSIDE_WINDOW_ERROR_CODES.has(Number(error.code))) return true;

    const text = `${error.message || ''}`.toLowerCase();
    return text.includes('outside the allowed window');
  }

  /**
   * Reserva la clave para esta notificación. Devuelve false si otra ya la
   * entregó o la tiene en curso.
   */
  private claimKey(key: string): boolean {
    this.pruneMap(this.deliveredKeys, DEDUPE_TTL_MS);
    this.pruneMap(this.inflightKeys, INFLIGHT_TTL_MS);

    if (this.deliveredKeys.has(key) || this.inflightKeys.has(key)) return false;

    this.inflightKeys.set(key, Date.now());
    return true;
  }

  private releaseKey(key: string, delivered: boolean): void {
    this.inflightKeys.delete(key);
    if (delivered) this.deliveredKeys.set(key, Date.now());
  }

  private trackSid(sid: string | undefined, admin: string): void {
    if (!sid) return;
    this.pruneSids();
    this.notificationSids.set(sid, { phone: admin, at: Date.now() });
  }

  private pruneSids(): void {
    const cutoff = Date.now() - SENT_SID_TTL_MS;
    for (const [sid, entry] of this.notificationSids) {
      if (entry.at < cutoff) this.notificationSids.delete(sid);
    }
  }

  private pruneMap(map: Map<string, number>, ttlMs: number): void {
    const cutoff = Date.now() - ttlMs;
    for (const [key, timestamp] of map) {
      if (timestamp < cutoff) map.delete(key);
    }
  }
}

/** Instancia compartida usada por controladores y webhooks. */
export const adminNotificationService = new AdminNotificationService();
