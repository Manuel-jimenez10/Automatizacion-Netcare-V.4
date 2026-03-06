"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuotePresentedService = void 0;
const espocrm_api_client_service_1 = require("./espocrm-api-client.service");
const twilio_service_1 = require("./twilio.service");
const env_1 = require("../config/env");
class QuotePresentedService {
    constructor() {
        this.espoCRMClient = new espocrm_api_client_service_1.EspoCRMClient();
    }
    /**
     * Maneja el evento de Quote Presentada (Webhook)
     * 1. Obtiene la Quote
     * 2. Valida Contacto de Facturación y Teléfono
     * 3. Obtiene URL del PDF
     * 4. Envía WhatsApp con Template
     * 5. Registra el mensaje en EspoCRM
     */
    async handleQuotePresented(quoteId) {
        console.log('\n🚀 ============================================');
        console.log(`🚀 Iniciando proceso de Quote Presentada: ${quoteId}`);
        console.log('🚀 ============================================\n');
        try {
            // 1. Obtener la Quote desde EspoCRM
            const quote = await this.espoCRMClient.getQuote(quoteId);
            console.log(`📋 Procesando Quote: "${quote.name}" (ID: ${quote.id})`);
            console.log(`   Estado: ${quote.status}`);
            // 2. Validar que tiene Contacto de Facturación (Billing Contact)
            if (!quote.billingContactId) {
                console.log(`⚠️ Advertencia: Quote "${quote.name}" (ID: ${quote.id}) no tiene Billing Contact asociado.`);
                throw new Error(`La Quote "${quote.name}" no tiene un Contacto de Facturación (Billing Contact) asignado.`);
            }
            console.log(`🔗 Billing Contact ID: ${quote.billingContactId}`);
            // 3. Obtener Contacto
            const contact = await this.espoCRMClient.getContact(quote.billingContactId);
            // 4. Extraer y validar teléfono desde el CONTACTO
            const phoneValidation = this.extractAndValidatePhone(contact);
            if (!phoneValidation.isValid) {
                throw new Error(`Billing Contact "${contact.name}" no tiene un teléfono válido: ${phoneValidation.error}`);
            }
            console.log(`📞 Teléfono válido (desde Billing Contact): ${phoneValidation.formattedNumber}`);
            // 5. Obtener nombre del cliente
            const clientName = contact.name || contact.firstName || 'Cliente';
            console.log(`👤 Cliente: ${clientName}`);
            // 6. Manejo del PDF
            let pdfUrl;
            const pdfFileId = quote.cotizacinPropuestaId; // Campo personalizado donde se guarda el PDF
            if (pdfFileId) {
                // Construir URL pública para el PDF via Proxy (EspoCRM requiere auth)
                // El proxy en /api/files/:id descarga de EspoCRM con API Key y lo sirve sin auth
                pdfUrl = `${env_1.env.publicUrl}/api/files/${pdfFileId}`;
                console.log(`📎 PDF adjunto detectado. ID: ${pdfFileId}`);
                console.log(`📎 URL Pública (Proxy): ${pdfUrl}`);
            }
            else {
                console.log('⚠️ No hay cotización adjunta (campo cotizacinPropuestaId vacío). Se enviará sin PDF.');
            }
            // 7. Enviar mensaje de WhatsApp
            console.log('📱 Enviando mensaje de cotización presentada...');
            const twilioResponse = await (0, twilio_service_1.sendQuotePresentedMessage)({
                phone: phoneValidation.formattedNumber,
                clientName: clientName,
                quoteName: quote.name,
                pdfUrl: pdfUrl,
            });
            // 8. Guardar mensaje en WhatsappMessage (EspoCRM)
            await this.logMessageInEspo(quote, phoneValidation.formattedNumber, clientName, twilioResponse);
            console.log('\n✅ ============================================');
            console.log('✅ Proceso de Quote Presentada completado exitosamente');
            console.log('✅ ============================================\n');
        }
        catch (error) {
            console.log('\n❌ ============================================');
            console.log(`❌ Error crítico en el proceso: ${error.message}`);
            console.log('❌ ============================================\n');
            throw error;
        }
    }
    /**
     * Registra el mensaje enviado en las entidades de EspoCRM (WhatsappMessage, WhatsappConverstion)
     */
    async logMessageInEspo(quote, phone, clientName, twilioResponse) {
        console.log('💾 Guardando mensaje en WhatsappMessage...');
        try {
            // Buscar o crear conversación
            let conversationId = '';
            const conversations = await this.espoCRMClient.searchEntities('WhatsappConverstion', [
                {
                    type: 'equals',
                    attribute: 'name',
                    value: phone
                }
            ]);
            if (conversations.length > 0) {
                conversationId = conversations[0].id;
                console.log(`✅ Conversación existente encontrada: ${conversationId}`);
            }
            else {
                console.log(`✨ Creando nueva conversación para ${phone}`);
                const conversationPayload = {
                    name: phone, // Nombre de conversación es el teléfono
                    description: `Conversación iniciada por Quote Presentada`
                };
                if (quote.billingContactName) {
                    conversationPayload.contact = quote.billingContactName;
                    if (quote.billingContactId) {
                        conversationPayload.contactId = quote.billingContactId;
                    }
                }
                const newConv = await this.espoCRMClient.createEntity('WhatsappConverstion', conversationPayload);
                conversationId = newConv.id;
            }
            // Crear registro de mensaje
            const senderPhone = env_1.env.twilioWhatsappFrom.replace('whatsapp:', '');
            const messagePayload = {
                name: senderPhone,
                contact: senderPhone,
                status: 'Sent',
                type: 'Out',
                description: `Cotización Presentada: ${quote.name}`,
                whatsappConverstionId: conversationId,
                messageSid: twilioResponse.sid,
                isRead: false
            };
            // Vincular con Contacto
            if (quote.billingContactId) {
                messagePayload.contactId = quote.billingContactId;
            }
            // Vincular con Quote (asumiendo campos custom)
            messagePayload.quoteId = quote.id;
            messagePayload.quoteName = quote.name;
            await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
            console.log(`✅ Mensaje guardado en WhatsappMessage con SID: ${twilioResponse.sid}`);
            // Actualizar conversación con último mensaje
            await this.espoCRMClient.updateEntity('WhatsappConverstion', conversationId, {
                description: `Cotización Presentada: ${quote.name}`,
                fechaHoraUltimoMensaje: new Date().toISOString().slice(0, 19).replace('T', ' '),
            });
        }
        catch (error) {
            console.error('❌ Error guardando mensaje en WhatsappMessage (el mensaje sí se envió):', error.message);
            // No relanzamos el error porque el envío de Twilio fue exitoso
        }
    }
    /**
     * Extrae y valida el número de teléfono (Reutilizado)
     */
    extractAndValidatePhone(entity) {
        console.log('🔍 Buscando número de teléfono en el contacto...');
        const phoneFields = ['phoneNumber', 'phoneMobile', 'phoneOffice', 'phone'];
        let phone;
        for (const field of phoneFields) {
            if (entity[field]) {
                phone = entity[field];
                console.log(`   ✓ Teléfono encontrado en campo: ${field}`);
                break;
            }
        }
        if (!phone) {
            return {
                isValid: false,
                error: `No se encontró número de teléfono. Campos revisados: ${phoneFields.join(', ')}`,
            };
        }
        let cleanedPhone = phone.replace(/[\s\-\(\)]/g, '');
        if (!cleanedPhone) {
            return { isValid: false, error: 'El número de teléfono está vacío después de limpiarlo' };
        }
        if (!cleanedPhone.startsWith('+')) {
            cleanedPhone = `+${cleanedPhone}`;
        }
        const digitsOnly = cleanedPhone.replace(/\D/g, '');
        if (digitsOnly.length < 10) {
            return {
                isValid: false,
                error: `El número de teléfono es muy corto: ${cleanedPhone} (solo ${digitsOnly.length} dígitos)`,
            };
        }
        console.log(`   ✓ Número limpiado y validado: ${cleanedPhone}`);
        return {
            isValid: true,
            formattedNumber: cleanedPhone,
        };
    }
}
exports.QuotePresentedService = QuotePresentedService;
