import { EspoCRMClient } from './espocrm-api-client.service';
import {
  sendTextMessage,
  sendDynamicTemplateMessage,
  getLastInboundMessageDate,
} from './twilio.service';
import { env } from '../config/env';
import { extractAndValidatePhone } from '../utils/phone-utils';
import { sanitizeTemplateVariable } from '../utils/notification-phone.utils';
import { htmlToWhatsappText } from '../utils/html-to-text';

/**
 * Mensaje informativo al cliente, lanzado a mano desde el CRM.
 *
 * ┌─ FLUJO ───────────────────────────────────────────────────────────────┐
 * │ 1. Un agente escribe el texto en el WhatsappMessage y marca la        │
 * │    casilla de envío.                                                  │
 * │ 2. Un workflow de EspoCRM llama a POST /api/whatsapp/send-info.       │
 * │ 3. Si el cliente escribió hace menos de 24 h → TEXTO PLANO (respeta   │
 * │    los saltos de línea). Si no → TEMPLATE aprobado.                   │
 * │ 4. Se escribe el SID en el registro y se desmarca la casilla.         │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Por qué hace falta el template: el flujo que ya existía
 * (/api/whatsapp/outgoing) envía texto libre, y WhatsApp solo lo permite
 * dentro de las 24 h siguientes al último mensaje del cliente. Fuera de esa
 * ventana Twilio responde 63016 y el mensaje no llega nunca.
 */

export type InfoChannel = 'template' | 'text';

export interface InfoSendResult {
  status: 'sent' | 'ignored';
  reason?: string;
  channel?: InfoChannel;
  sid?: string;
  /** Texto final que recibió el cliente. */
  preview?: string;
}

interface Dependencies {
  espoCRMClient?: any;
  sendText?: typeof sendTextMessage;
  sendTemplate?: typeof sendDynamicTemplateMessage;
  lookupLastInbound?: typeof getLastInboundMessageDate;
}

/**
 * Registros en vuelo. Un workflow de EspoCRM puede reintentar si la respuesta
 * tarda, y sin este candado el cliente recibiría el mensaje dos veces.
 */
const inFlight = new Set<string>();

export class WhatsappInfoService {
  private espoCRMClient: any;
  private sendText: typeof sendTextMessage;
  private sendTemplate: typeof sendDynamicTemplateMessage;
  private lookupLastInbound: typeof getLastInboundMessageDate;

  constructor(deps: Dependencies = {}) {
    this.espoCRMClient = deps.espoCRMClient || new EspoCRMClient();
    this.sendText = deps.sendText || sendTextMessage;
    this.sendTemplate = deps.sendTemplate || sendDynamicTemplateMessage;
    this.lookupLastInbound = deps.lookupLastInbound || getLastInboundMessageDate;
  }

  /** Texto final tal cual lo verá el cliente. */
  buildText(clientName: string, body: string): string {
    return env.whatsappInfoTextFormat
      .replace(/\{\{\s*1\s*\}\}/g, clientName)
      .replace(/\{\{\s*2\s*\}\}/g, body);
  }

  async handleSendInfo(payload: any): Promise<InfoSendResult> {
    if (!env.whatsappInfoEnabled) {
      return { status: 'ignored', reason: 'disabled' };
    }

    // EspoCRM manda los campos en snake_case; se aceptan las dos formas, igual
    // que en /api/whatsapp-init/send.
    const entityId =
      payload?.id ||
      payload?.entityId ||
      payload?.entity_id ||
      payload?.messageId ||
      payload?.message_id ||
      payload?.whatsappMessageId;

    if (!entityId) {
      throw new Error(
        'Falta el id del WhatsappMessage en el payload (acepta id, entity_id o entityId)',
      );
    }

    if (inFlight.has(entityId)) {
      return { status: 'ignored', reason: 'already_in_progress' };
    }

    // El workflow ya resuelve el contacto, así que lo aprovechamos: si el
    // registro tuviera el enlace vacío, seguimos pudiendo poner el nombre.
    const contactId = payload?.contact_id || payload?.contactId || '';

    inFlight.add(entityId);
    try {
      return await this.process(entityId, contactId);
    } finally {
      inFlight.delete(entityId);
    }
  }

  private async process(entityId: string, contactIdFromPayload = ''): Promise<InfoSendResult> {
    console.log('\n📨 ============================================');
    console.log(`📨 Mensaje informativo solicitado para WhatsappMessage ${entityId}`);
    console.log('📨 ============================================');

    // Se relee la entidad completa: el payload del workflow puede no traer los
    // campos custom, y necesitamos el estado más reciente.
    const entity = await this.espoCRMClient.getEntity('WhatsappMessage', entityId);

    // Guard de idempotencia: si ya salió, no se repite. Cubre el reintento del
    // workflow y el caso de que el flujo antiguo ya lo hubiera enviado.
    if (entity.messageSid) {
      console.log(`   ↪ El registro ya tiene SID (${entity.messageSid}). No se reenvía.`);
      return { status: 'ignored', reason: 'already_sent' };
    }

    // El campo es Wysiwyg: guarda HTML. Se convierte a texto plano con el
    // formato propio de WhatsApp (*negrita*, _cursiva_) antes de nada; enviarlo
    // crudo haría que el cliente viera las etiquetas.
    const rawField = String(entity[env.whatsappInfoTextField] ?? '');
    const rawText = htmlToWhatsappText(rawField);

    if (!rawText) {
      throw new Error(
        `El campo "${env.whatsappInfoTextField}" está vacío o no existe en WhatsappMessage. ` +
          `Comprueba el nombre interno en Entity Manager y ajústalo con WHATSAPP_INFO_TEXT_FIELD.`,
      );
    }

    const { phone, clientName } = await this.resolveRecipient(entity, contactIdFromPayload);
    console.log(`   👤 ${clientName} — ${phone}`);

    const windowOpen = await this.isWindowOpen(phone);
    const channel: InfoChannel = windowOpen ? 'text' : 'template';

    // Dentro de la ventana se manda texto libre y los saltos de línea se
    // respetan. Fuera hay que usar el template, y Meta rechaza las variables
    // con saltos de línea, tabuladores o espacios consecutivos.
    const bodyForChannel =
      channel === 'text'
        ? this.trim(rawText)
        : sanitizeTemplateVariable(rawText, env.whatsappInfoMaxTextChars);

    const finalText = this.buildText(clientName, bodyForChannel);

    let message: any;
    if (channel === 'text') {
      console.log('   💬 Ventana de 24h ABIERTA → texto plano (con saltos de línea)');
      message = await this.sendText({
        phone,
        text: finalText,
        statusCallback: env.twilioStatusCallbackUrl,
      });
    } else {
      if (!env.whatsappInfoTemplateSid) {
        throw new Error(
          'WHATSAPP_INFO_SID no está configurado y el cliente está fuera de la ventana de 24h: ' +
            'no hay forma de entregarle el mensaje.',
        );
      }
      console.log('   📋 Ventana de 24h CERRADA → template aprobado');
      message = await this.sendTemplate({
        phone,
        contentSid: env.whatsappInfoTemplateSid,
        contentVariables: { '1': clientName, '2': bodyForChannel },
      });
    }

    await this.markAsSent(entityId, message, finalText);

    console.log(`   ✅ Enviado por ${channel} — SID: ${message?.sid}`);
    console.log('📨 ============================================\n');

    return {
      status: 'sent',
      channel,
      sid: message?.sid,
      preview: message?.body || finalText,
    };
  }

  /**
   * Teléfono y nombre del destinatario.
   *
   * El nombre sale del Contact vinculado (campo `name`). El teléfono se toma
   * del registro si trae uno utilizable y, si no, del propio contacto.
   */
  private async resolveRecipient(
    entity: any,
    contactIdFromPayload = '',
  ): Promise<{ phone: string; clientName: string }> {
    let contact: any = null;

    // El id del propio registro manda; el del payload es la red de seguridad.
    const contactId = entity.contactId || contactIdFromPayload;

    if (contactId) {
      try {
        contact = await this.espoCRMClient.getContact(contactId);
      } catch (error: any) {
        console.warn(`   ⚠️ No se pudo leer el Contact ${contactId}: ${error.message}`);
      }
    }

    const clientName = contact?.name || contact?.firstName || 'cliente';

    // Convención del proyecto: `name` guarda el teléfono del destinatario.
    const fromRecord = String(entity.name || '');
    if (fromRecord.replace(/\D/g, '').length >= 10) {
      const validation = extractAndValidatePhone({ phoneNumber: fromRecord } as any);
      if (validation.isValid) {
        return { phone: validation.formattedNumber!, clientName };
      }
    }

    if (contact) {
      const validation = extractAndValidatePhone(contact);
      if (validation.isValid) {
        return { phone: validation.formattedNumber!, clientName };
      }
    }

    throw new Error(
      'No se pudo determinar un teléfono válido: ni el campo Name del mensaje ni el Contact vinculado tienen uno.',
    );
  }

  /**
   * ¿El cliente nos escribió en las últimas 24 h?
   *
   * Ante un fallo de Twilio se asume ventana CERRADA: mandar el template
   * siempre llega, mientras que mandar texto libre fuera de la ventana falla
   * con 63016 y el cliente no recibe nada.
   */
  private async isWindowOpen(phone: string): Promise<boolean> {
    if (!env.whatsappInfoUseWindow) return false;

    try {
      const lastInbound = await this.lookupLastInbound(phone, 24);
      return !!lastInbound;
    } catch (error: any) {
      console.warn(`   ⚠️ No se pudo consultar el historial de Twilio: ${error.message}`);
      return false;
    }
  }

  /** Deja el registro cerrado: SID, estado, texto enviado y casilla desmarcada. */
  private async markAsSent(entityId: string, message: any, finalText: string): Promise<void> {
    const update: any = {
      messageSid: message?.sid,
      status: 'Sent',
      type: 'Out',
      description: message?.body || finalText,
      // Desmarcar evita que volver a guardar el registro dispare otro envío.
      [env.whatsappInfoTriggerField]: false,
    };

    try {
      await this.espoCRMClient.updateEntity('WhatsappMessage', entityId, update);
    } catch (error: any) {
      // El mensaje ya salió: no se convierte en error del envío, pero hay que
      // gritarlo, porque sin el SID el registro se puede reenviar.
      console.error(
        `   🚨 El mensaje SALIÓ (SID ${message?.sid}) pero no se pudo actualizar el registro: ${error.message}`,
      );
      console.error('   🚨 Desmarca la casilla a mano para que no se reenvíe.');
    }
  }

  private trim(text: string): string {
    const max = env.whatsappInfoMaxTextChars;
    if (max > 1 && text.length > max) return `${text.slice(0, max - 1).trimEnd()}…`;
    return text;
  }
}
