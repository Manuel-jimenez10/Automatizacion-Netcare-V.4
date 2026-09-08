"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappInfoService = void 0;
const espocrm_api_client_service_1 = require("./espocrm-api-client.service");
const twilio_service_1 = require("./twilio.service");
const env_1 = require("../config/env");
const phone_utils_1 = require("../utils/phone-utils");
const notification_phone_utils_1 = require("../utils/notification-phone.utils");
const html_to_text_1 = require("../utils/html-to-text");
/**
 * Registros en vuelo. Un workflow de EspoCRM puede reintentar si la respuesta
 * tarda, y sin este candado el cliente recibiría el mensaje dos veces.
 */
const inFlight = new Set();
class WhatsappInfoService {
    constructor(deps = {}) {
        this.espoCRMClient = deps.espoCRMClient || new espocrm_api_client_service_1.EspoCRMClient();
        this.sendText = deps.sendText || twilio_service_1.sendTextMessage;
        this.sendTemplate = deps.sendTemplate || twilio_service_1.sendDynamicTemplateMessage;
        this.lookupLastInbound = deps.lookupLastInbound || twilio_service_1.getLastInboundMessageDate;
    }
    /** Texto final tal cual lo verá el cliente. */
    buildText(clientName, body) {
        return env_1.env.whatsappInfoTextFormat
            .replace(/\{\{\s*1\s*\}\}/g, clientName)
            .replace(/\{\{\s*2\s*\}\}/g, body);
    }
    async handleSendInfo(payload) {
        if (!env_1.env.whatsappInfoEnabled) {
            return { status: 'ignored', reason: 'disabled' };
        }
        // EspoCRM manda los campos en snake_case; se aceptan las dos formas, igual
        // que en /api/whatsapp-init/send.
        const entityId = payload?.id ||
            payload?.entityId ||
            payload?.entity_id ||
            payload?.messageId ||
            payload?.message_id ||
            payload?.whatsappMessageId;
        if (!entityId) {
            throw new Error('Falta el id del WhatsappMessage en el payload (acepta id, entity_id o entityId)');
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
        }
        finally {
            inFlight.delete(entityId);
        }
    }
    async process(entityId, contactIdFromPayload = '') {
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
        const rawField = String(entity[env_1.env.whatsappInfoTextField] ?? '');
        const rawText = (0, html_to_text_1.htmlToWhatsappText)(rawField);
        if (!rawText) {
            throw new Error(`El campo "${env_1.env.whatsappInfoTextField}" está vacío o no existe en WhatsappMessage. ` +
                `Comprueba el nombre interno en Entity Manager y ajústalo con WHATSAPP_INFO_TEXT_FIELD.`);
        }
        const { phone, clientName } = await this.resolveRecipient(entity, contactIdFromPayload);
        console.log(`   👤 ${clientName} — ${phone}`);
        const windowOpen = await this.isWindowOpen(phone);
        const channel = windowOpen ? 'text' : 'template';
        // Dentro de la ventana se manda texto libre y los saltos de línea se
        // respetan. Fuera hay que usar el template, y Meta rechaza las variables
        // con saltos de línea, tabuladores o espacios consecutivos.
        const bodyForChannel = channel === 'text'
            ? this.trim(rawText)
            : (0, notification_phone_utils_1.sanitizeTemplateVariable)(rawText, env_1.env.whatsappInfoMaxTextChars);
        const finalText = this.buildText(clientName, bodyForChannel);
        let message;
        if (channel === 'text') {
            console.log('   💬 Ventana de 24h ABIERTA → texto plano (con saltos de línea)');
            message = await this.sendText({
                phone,
                text: finalText,
                statusCallback: env_1.env.twilioStatusCallbackUrl,
            });
        }
        else {
            if (!env_1.env.whatsappInfoTemplateSid) {
                throw new Error('WHATSAPP_INFO_SID no está configurado y el cliente está fuera de la ventana de 24h: ' +
                    'no hay forma de entregarle el mensaje.');
            }
            console.log('   📋 Ventana de 24h CERRADA → template aprobado');
            message = await this.sendTemplate({
                phone,
                contentSid: env_1.env.whatsappInfoTemplateSid,
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
    async resolveRecipient(entity, contactIdFromPayload = '') {
        let contact = null;
        // El id del propio registro manda; el del payload es la red de seguridad.
        const contactId = entity.contactId || contactIdFromPayload;
        if (contactId) {
            try {
                contact = await this.espoCRMClient.getContact(contactId);
            }
            catch (error) {
                console.warn(`   ⚠️ No se pudo leer el Contact ${contactId}: ${error.message}`);
            }
        }
        const clientName = contact?.name || contact?.firstName || 'cliente';
        // Convención del proyecto: `name` guarda el teléfono del destinatario.
        const fromRecord = String(entity.name || '');
        if (fromRecord.replace(/\D/g, '').length >= 10) {
            const validation = (0, phone_utils_1.extractAndValidatePhone)({ phoneNumber: fromRecord });
            if (validation.isValid) {
                return { phone: validation.formattedNumber, clientName };
            }
        }
        if (contact) {
            const validation = (0, phone_utils_1.extractAndValidatePhone)(contact);
            if (validation.isValid) {
                return { phone: validation.formattedNumber, clientName };
            }
        }
        throw new Error('No se pudo determinar un teléfono válido: ni el campo Name del mensaje ni el Contact vinculado tienen uno.');
    }
    /**
     * ¿El cliente nos escribió en las últimas 24 h?
     *
     * Ante un fallo de Twilio se asume ventana CERRADA: mandar el template
     * siempre llega, mientras que mandar texto libre fuera de la ventana falla
     * con 63016 y el cliente no recibe nada.
     */
    async isWindowOpen(phone) {
        if (!env_1.env.whatsappInfoUseWindow)
            return false;
        try {
            const lastInbound = await this.lookupLastInbound(phone, 24);
            return !!lastInbound;
        }
        catch (error) {
            console.warn(`   ⚠️ No se pudo consultar el historial de Twilio: ${error.message}`);
            return false;
        }
    }
    /** Deja el registro cerrado: SID, estado, texto enviado y casilla desmarcada. */
    async markAsSent(entityId, message, finalText) {
        const update = {
            messageSid: message?.sid,
            status: 'Sent',
            type: 'Out',
            description: message?.body || finalText,
            // Desmarcar evita que volver a guardar el registro dispare otro envío.
            [env_1.env.whatsappInfoTriggerField]: false,
        };
        try {
            await this.espoCRMClient.updateEntity('WhatsappMessage', entityId, update);
        }
        catch (error) {
            // El mensaje ya salió: no se convierte en error del envío, pero hay que
            // gritarlo, porque sin el SID el registro se puede reenviar.
            console.error(`   🚨 El mensaje SALIÓ (SID ${message?.sid}) pero no se pudo actualizar el registro: ${error.message}`);
            console.error('   🚨 Desmarca la casilla a mano para que no se reenvíe.');
        }
    }
    trim(text) {
        const max = env_1.env.whatsappInfoMaxTextChars;
        if (max > 1 && text.length > max)
            return `${text.slice(0, max - 1).trimEnd()}…`;
        return text;
    }
}
exports.WhatsappInfoService = WhatsappInfoService;
