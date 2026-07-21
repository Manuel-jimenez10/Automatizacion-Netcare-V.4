"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappAllContactsService = exports.createInitialAllContactsProgress = void 0;
const env_1 = require("../config/env");
const phone_utils_1 = require("../utils/phone-utils");
const espocrm_api_client_service_1 = require("./espocrm-api-client.service");
const twilio_service_1 = require("./twilio.service");
const DEFAULT_PAGE_SIZE = 100;
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
 * Envia un WhatsappTemplate a todos los Contact que tengan valor en `phone`.
 * No usa reportes: recorre la entidad Contact directamente y por paginas.
 */
class WhatsappAllContactsService {
    constructor(options = {}) {
        this.espoCRMClient = options.espoCRMClient || new espocrm_api_client_service_1.EspoCRMClient();
        this.sendTemplateMessage = options.sendTemplateMessage || twilio_service_1.sendDynamicTemplateMessage;
        this.pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
        this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    }
    async handleAllContactsSend(templateRecordId, onProgress) {
        console.log('\n🚀 ============================================');
        console.log(`🚀 Iniciando template para TODOS los Contacts: ${templateRecordId}`);
        console.log('🚀 ============================================\n');
        const template = await this.espoCRMClient.getEntity('WhatsappTemplate', templateRecordId);
        this.validateTemplate(template);
        const attachmentUrl = `${env_1.env.publicUrl}/api/files/${template.archivoAdjuntoId}`;
        const progress = (0, exports.createInitialAllContactsProgress)();
        const processedPhones = new Set();
        let offset = 0;
        console.log(`📋 Template: "${template.name}" (ID: ${template.id})`);
        console.log(`   - SID Twilio: ${template.whatsappTemplateSID}`);
        console.log(`   - Imagen publica: ${attachmentUrl}`);
        console.log('   - Audiencia: todos los Contact con phone');
        while (true) {
            const page = await this.espoCRMClient.listEntitiesPage('Contact', {
                offset,
                maxSize: this.pageSize,
                select: 'id,name,phone',
                where: [
                    {
                        type: 'isNotNull',
                        attribute: 'phone',
                    },
                ],
                orderBy: 'id',
                order: 'asc',
            });
            if (page.total >= 0) {
                progress.totalContacts = page.total;
            }
            if (page.list.length === 0) {
                break;
            }
            console.log(`\n📄 Contactos ${offset + 1}-${offset + page.list.length}` +
                `${progress.totalContacts !== null ? ` de ${progress.totalContacts}` : ''}`);
            for (const contact of page.list) {
                await this.processContact(contact, template, attachmentUrl, processedPhones, progress);
                onProgress?.(this.cloneProgress(progress));
            }
            offset += page.list.length;
            if (page.list.length < this.pageSize) {
                break;
            }
        }
        if (progress.totalContacts === null) {
            progress.totalContacts = progress.processed;
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
    validateTemplate(template) {
        if (!template.whatsappTemplateSID) {
            throw new Error(`El template "${template.name}" no tiene SID de Twilio configurado.`);
        }
        if (!template.archivoAdjuntoId) {
            throw new Error(`El template "${template.name}" no tiene Archivo Adjunto. La variable {{2}} requiere una imagen.`);
        }
    }
    async processContact(contact, template, attachmentUrl, processedPhones, progress) {
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
        const contactName = contact.name?.trim() || 'Cliente';
        try {
            const twilioResponse = await this.sendTemplateMessage({
                phone: validPhone,
                contentSid: template.whatsappTemplateSID,
                contentVariables: {
                    '1': contactName,
                    '2': attachmentUrl,
                },
            });
            await this.logMessageInEspo(template, contact, validPhone, twilioResponse);
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
    async logMessageInEspo(template, contact, phone, twilioResponse) {
        try {
            const conversations = await this.espoCRMClient.searchEntities('WhatsappConverstion', [
                {
                    type: 'equals',
                    attribute: 'name',
                    value: phone,
                },
            ]);
            const conversationId = conversations[0]?.id;
            const description = template.contentMessageTemplate ||
                `Template ${template.name} enviado a ${contact.name || 'Cliente'}`;
            const messagePayload = {
                name: phone,
                contact: phone,
                contactId: contact.id,
                status: 'Sent',
                type: 'Out',
                description,
                messageSid: twilioResponse.sid,
                isRead: false,
                archivoAdjuntoId: template.archivoAdjuntoId,
            };
            if (conversationId) {
                messagePayload.whatsappConverstionId = conversationId;
            }
            await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
            if (conversationId) {
                await this.espoCRMClient.updateEntity('WhatsappConverstion', conversationId, {
                    description: description.substring(0, 100),
                    fechaHoraUltimoMensaje: new Date()
                        .toISOString()
                        .slice(0, 19)
                        .replace('T', ' '),
                });
            }
        }
        catch (error) {
            console.error('   ⚠️ El mensaje se envio, pero no se pudo registrar en EspoCRM:', error.message);
        }
    }
    recordError(progress, contact, phone, error) {
        if (progress.errors.length >= MAX_RECORDED_ERRORS) {
            return;
        }
        progress.errors.push({
            contactId: contact.id,
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
