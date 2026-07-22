"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappAllContactsService = exports.createInitialAllContactsProgress = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const phone_utils_1 = require("../utils/phone-utils");
const espocrm_api_client_service_1 = require("./espocrm-api-client.service");
const twilio_service_1 = require("./twilio.service");
const CONTACTS_REPORT_ID = '69c1bf528b8fb6477';
const DEFAULT_DELAY_MS = 1500;
const MAX_RECORDED_ERRORS = 200;
const createInitialAllContactsProgress = () => ({
    totalContacts: null,
    processed: 0,
    sent: 0,
    failed: 0,
    skippedWithoutPhone: 0,
    skippedDuplicatePhone: 0,
    errors: [],
});
exports.createInitialAllContactsProgress = createInitialAllContactsProgress;
/**
 * Envia un WhatsappTemplate a los Contact incluidos en el reporte configurado.
 * El reporte filtra los contactos con Phone y exporta name + phone/phoneNumber.
 */
class WhatsappAllContactsService {
    constructor(options = {}) {
        this.espoCRMClient = options.espoCRMClient || new espocrm_api_client_service_1.EspoCRMClient();
        this.sendTemplateMessage = options.sendTemplateMessage || twilio_service_1.sendDynamicTemplateMessage;
        this.reportContactsLoader = options.reportContactsLoader;
        this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    }
    async handleAllContactsSend(templateRecordId, onProgress) {
        console.log('\n🚀 ============================================');
        console.log(`🚀 Iniciando template para TODOS los Contacts: ${templateRecordId}`);
        console.log('🚀 ============================================\n');
        const template = await this.espoCRMClient.getEntity('WhatsappTemplate', templateRecordId);
        this.validateTemplate(template);
        const progress = (0, exports.createInitialAllContactsProgress)();
        const processedPhones = new Set();
        console.log(`📋 Template: "${template.name}" (ID: ${template.id})`);
        console.log(`   - SID Twilio: ${template.whatsappTemplateSID}`);
        console.log('   - Imagen: estatica dentro del template multimedia de Twilio');
        const testRecipients = this.getTestRecipients();
        const enTestMode = testRecipients.length > 0;
        let contacts;
        if (enTestMode) {
            console.log('🧪 ============================================');
            console.log(`🧪 MODO PRUEBA (BULK_TEST_RECIPIENTS): solo ${testRecipients.length} numero(s), se ignora el reporte`);
            testRecipients.forEach(r => console.log(`   - ${r.phone}`));
            console.log('🧪 ============================================');
            contacts = testRecipients;
        }
        else {
            const reportId = this.getReportId();
            console.log(`   - Audiencia: reporte ${reportId}`);
            contacts = this.reportContactsLoader
                ? await this.reportContactsLoader(reportId)
                : await this.exportReportAndParseContacts(reportId);
        }
        progress.totalContacts = contacts.length;
        console.log(`\n📊 Contactos a procesar: ${contacts.length}`);
        for (const contact of contacts) {
            await this.processContact(contact, template, processedPhones, progress);
            onProgress?.(this.cloneProgress(progress));
        }
        console.log('\n✅ ============================================');
        console.log(`✅ Envio masivo finalizado: ${progress.sent} enviados`);
        console.log(`   - Procesados: ${progress.processed}`);
        console.log(`   - Fallidos: ${progress.failed}`);
        console.log(`   - Sin phone: ${progress.skippedWithoutPhone}`);
        console.log(`   - Telefonos duplicados: ${progress.skippedDuplicatePhone}`);
        console.log('✅ ============================================\n');
        onProgress?.(this.cloneProgress(progress));
        return progress;
    }
    /**
     * Lista de prueba opcional (env BULK_TEST_RECIPIENTS). Si esta definida, el
     * envio masivo ignora el reporte y solo manda a estos numeros. Vaciar la
     * variable para volver al envio normal a todos los contactos.
     */
    getTestRecipients() {
        const raw = env_1.env.bulkTestRecipients;
        if (!raw || !raw.trim()) {
            return [];
        }
        return raw
            .split(',')
            .map(value => value.trim())
            .filter(value => value !== '')
            .map(phone => ({ name: 'Prueba', phone }));
    }
    /**
     * ID del Report que define la audiencia. Usa BULK_CONTACTS_REPORT_ID si esta
     * definida; de lo contrario cae al reporte por defecto del codigo.
     */
    getReportId() {
        const configured = env_1.env.bulkContactsReportId?.trim();
        return configured || CONTACTS_REPORT_ID;
    }
    /** Reutiliza el mismo mecanismo de exportacion CSV del modulo funcional. */
    async exportReportAndParseContacts(reportId) {
        console.log(`\n📄 Exportando reporte ${reportId} a CSV...`);
        const exportResponse = await this.espoCRMClient.request('POST', 'Report/action/exportList', { id: reportId, format: 'csv' });
        if (!exportResponse.id) {
            throw new Error('EspoCRM no devolvio el ID del CSV exportado.');
        }
        let baseUrl = env_1.env.espocrmBaseUrl;
        baseUrl = baseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
        const downloadUrl = `${baseUrl}/?entryPoint=download&id=${exportResponse.id}`;
        const downloadResponse = await axios_1.default.get(downloadUrl, {
            headers: { 'X-Api-Key': env_1.env.espocrmApiKey },
            responseType: 'arraybuffer',
        });
        const csvContent = Buffer.from(downloadResponse.data).toString('utf-8');
        const lines = csvContent
            .split(/\r?\n/)
            .filter((line) => line.trim() !== '');
        if (lines.length < 2) {
            return [];
        }
        const headers = lines[0]
            .replace(/^\uFEFF/, '')
            .split(';')
            .map(header => header.replace(/^"|"$/g, '').trim());
        const idIdx = headers.indexOf('id');
        const nameIdx = headers.indexOf('name');
        let phoneIdx = headers.indexOf('phoneNumber');
        if (phoneIdx === -1) {
            phoneIdx = headers.indexOf('phone');
        }
        if (nameIdx === -1 || phoneIdx === -1) {
            throw new Error(`El reporte no tiene las columnas requeridas (name y phone o phoneNumber). ` +
                `Columnas encontradas: ${headers.join(', ')}`);
        }
        const contacts = [];
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split(';');
            const id = idIdx >= 0 ? this.cleanCsvValue(row[idIdx]) : undefined;
            const name = this.cleanCsvValue(row[nameIdx]);
            const phone = this.cleanCsvValue(row[phoneIdx]).replace(/^'/, '');
            if (name || phone) {
                contacts.push({ id, name, phone });
            }
        }
        return contacts;
    }
    cleanCsvValue(value) {
        return (value || '').replace(/^"|"$/g, '').trim();
    }
    validateTemplate(template) {
        if (!template.whatsappTemplateSID) {
            throw new Error(`El template "${template.name}" no tiene SID de Twilio configurado.`);
        }
    }
    async processContact(contact, template, processedPhones, progress) {
        progress.processed++;
        const rawPhone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
        if (!rawPhone) {
            progress.skippedWithoutPhone++;
            return;
        }
        const phoneValidation = (0, phone_utils_1.extractAndValidatePhone)({ phone: rawPhone });
        if (!phoneValidation.isValid || !phoneValidation.formattedNumber) {
            progress.failed++;
            this.recordError(progress, contact, rawPhone, phoneValidation.error || 'Telefono invalido');
            return;
        }
        const validPhone = phoneValidation.formattedNumber;
        if (processedPhones.has(validPhone)) {
            progress.skippedDuplicatePhone++;
            console.log(`   ↪ Telefono duplicado omitido: ${validPhone}`);
            return;
        }
        processedPhones.add(validPhone);
        // Las variables de templates aprobados no admiten saltos de linea ni
        // secuencias largas de espacios. El fallback evita valores vacios.
        const contactName = this.sanitizeTemplateVariable(contact.name, 'Cliente');
        try {
            const twilioResponse = await this.sendTemplateMessage({
                phone: validPhone,
                contentSid: template.whatsappTemplateSID,
                contentVariables: {
                    '1': contactName,
                },
            });
            const sentMessageText = this.getActualSentMessage(twilioResponse, contactName);
            await this.logMessageInEspo(template, contact, validPhone, twilioResponse, sentMessageText);
            progress.sent++;
            console.log(`   ✅ Enviado a ${contactName} (${validPhone})`);
        }
        catch (error) {
            progress.failed++;
            this.recordError(progress, contact, validPhone, error.message);
            console.error(`   ❌ Error enviando a ${contactName}: ${error.message}`);
        }
        finally {
            if (this.delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, this.delayMs));
            }
        }
    }
    async logMessageInEspo(template, contact, phone, twilioResponse, sentMessageText) {
        try {
            // El mensaje se guarda SOLO en WhatsappMessage, con el telefono del
            // destinatario en 'name'. El workflow de EspoCRM lo empareja con el
            // Contact y la conversacion a partir de ese numero (conversacion vacia aqui).
            const messagePayload = {
                name: phone,
                contact: phone,
                status: 'Sent',
                type: 'Out',
                description: sentMessageText,
                messageSid: twilioResponse.sid,
                isRead: false,
            };
            if (template.archivoAdjuntoId) {
                messagePayload.archivoAdjuntoId = template.archivoAdjuntoId;
            }
            if (contact.id) {
                messagePayload.contactId = contact.id;
            }
            console.log('   📤 [WhatsappMessage] Campos a guardar en EspoCRM:');
            console.log(`      - Name (telefono destinatario): ${messagePayload.name}`);
            console.log(`      - Mensaje (description): ${messagePayload.description}`);
            console.log(`      - Conversacion: ${messagePayload.whatsappConverstionId || '(vacia)'}`);
            console.log(`      - Tipo: ${messagePayload.type}`);
            console.log(`      - Status: ${messagePayload.status}`);
            await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
        }
        catch (error) {
            console.error('   ⚠️ El mensaje se envio, pero no se pudo registrar en EspoCRM:', error.message);
        }
    }
    getActualSentMessage(twilioResponse, contactName) {
        if (typeof twilioResponse?.body === 'string' && twilioResponse.body.trim()) {
            return twilioResponse.body.trim();
        }
        console.warn(`   ⚠️ Twilio no devolvio body para ${contactName}; se guardara un indicador sin usar contentMessageTemplate.`);
        return `Mensaje de WhatsApp enviado a ${contactName}`;
    }
    sanitizeTemplateVariable(value, fallback) {
        const sanitized = (value || '').replace(/\s+/g, ' ').trim();
        return sanitized || fallback;
    }
    recordError(progress, contact, phone, error) {
        if (progress.errors.length >= MAX_RECORDED_ERRORS) {
            return;
        }
        progress.errors.push({
            contactId: contact.id || '',
            contact: contact.name || '',
            phone,
            error,
        });
    }
    cloneProgress(progress) {
        return {
            ...progress,
            errors: progress.errors.map(error => ({ ...error })),
        };
    }
}
exports.WhatsappAllContactsService = WhatsappAllContactsService;
