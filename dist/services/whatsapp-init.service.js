"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappInitService = void 0;
const espocrm_api_client_service_1 = require("./espocrm-api-client.service");
const twilio_service_1 = require("./twilio.service");
const env_1 = require("../config/env");
const phone_utils_1 = require("../utils/phone-utils");
class WhatsappInitService {
    constructor() {
        this.espoCRMClient = new espocrm_api_client_service_1.EspoCRMClient();
    }
    async handleInitConversation(contactId) {
        console.log('\n🚀 ============================================');
        console.log(`🚀 Iniciando WhatsApp de apertura para el Contacto ID: ${contactId}`);
        console.log('🚀 ============================================\n');
        try {
            // 1. Obtener la información del Contacto
            const contact = await this.espoCRMClient.getContact(contactId);
            // Usar phone-utils para encontrar y validar el número de teléfono primario o del campo phoneNumber
            // Si el contacto tiene campo 'phoneNumber', 'phone', o 'phoneNumberData', phone-utils lo buscará.
            // Pero 'extractAndValidatePhone' espera un objeto con { phoneNumber?: string, phoneMobile?: string, ... }
            const phoneValidation = (0, phone_utils_1.extractAndValidatePhone)({
                phoneNumber: contact.phoneNumber,
                phoneMobile: contact.phoneMobile,
                phoneOffice: contact.phoneOffice,
                phone: contact.phone,
                phoneNumberData: contact.phoneNumberData
            });
            if (!phoneValidation.isValid) {
                throw new Error(`El contacto ${contact.name} no tiene un número de teléfono válido: ${phoneValidation.error}`);
            }
            const validPhone = phoneValidation.formattedNumber;
            // 2. Preparar el contenido del template para registrar en EspoCRM
            const templateContent = `Hola ${contact.name}.\nRecibimos tu contacto para información sobre nuestros servicios en Netcare MX.\n\nPodemos apoyarte en automatización de portones, accesos, cámaras y soluciones tecnológicas.\n\nSi deseas que continuemos por WhatsApp, respóndenos a este mensaje y te atendemos de inmediato.`;
            // 3. Enviar template por Twilio
            const contentVariables = {
                '1': contact.name, // Utilizamos el nombre completo del contacto o firstName asumes que pasaste en Espo
            };
            if (!env_1.env.mensajeIniciarWhatsapp) {
                throw new Error('La variable de entorno MENSAJE_INICIAR_WHATSAPP no está configurada.');
            }
            const twilioResponse = await (0, twilio_service_1.sendDynamicTemplateMessage)({
                phone: validPhone,
                contentSid: env_1.env.mensajeIniciarWhatsapp,
                contentVariables,
            });
            // 4. Registrar en WhatsappMessage y WhatsappConverstion
            await this.logMessageInEspo(validPhone, contact.name, contactId, templateContent, twilioResponse);
            console.log('\n✅ ============================================');
            console.log(`✅ Envío de apertura completado exitosamente a: ${contact.name}`);
            console.log('✅ ============================================\n');
            return {
                success: true,
                contactName: contact.name,
                phone: validPhone,
                messageSid: twilioResponse.sid
            };
        }
        catch (error) {
            console.log('\n❌ ============================================');
            console.log(`❌ Error al enviar mensaje de apertura: ${error.message}`);
            console.log('❌ ============================================\n');
            throw error;
        }
    }
    async logMessageInEspo(phone, contactName, contactId, templateContent, twilioResponse) {
        console.log('   💾 Guardando mensaje de apertura en WhatsappMessage...');
        try {
            // Buscar conversación existente por número de teléfono
            let conversationId = null;
            const conversations = await this.espoCRMClient.searchEntities('WhatsappConverstion', [
                {
                    type: 'equals',
                    attribute: 'name',
                    value: phone,
                },
            ]);
            if (conversations.length > 0) {
                conversationId = conversations[0].id;
                console.log(`   ✅ Conversación existente: ${conversationId}`);
            }
            else {
                console.log(`   ℹ️ No hay conversación previa para ${phone}, se guardará solo el mensaje, o podrías crearla opcionalmente.`);
                // Para este flujo normalmente si Espo no la tiene, WhatsappMessage se guarda sin link
                // y el webhook entrante de Twilio cuando el cliente responda, creará la conversación.
                // Opcional: Podrías forzar crear la conversación aquí.
                console.log(`   ✨ Creando nueva conversación para: ${phone}`);
                const newConversation = await this.espoCRMClient.createEntity('WhatsappConverstion', {
                    name: phone,
                });
                conversationId = newConversation.id;
            }
            // Crear registro de WhatsappMessage con el contenido real
            const senderPhone = env_1.env.twilioWhatsappFrom.replace('whatsapp:', '');
            const messagePayload = {
                name: senderPhone,
                contact: senderPhone, // EspoCRM usualmente lo usa internamente así o lo asocia via relation
                status: 'Sent',
                type: 'Out',
                description: templateContent,
                messageSid: twilioResponse.sid,
                isRead: false,
            };
            if (conversationId) {
                messagePayload.whatsappConverstionId = conversationId;
            }
            const createdMessage = await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
            console.log(`   ✅ Mensaje guardado en WhatsappMessage (ID: ${createdMessage.id})`);
            // Vincular el mensaje directamente con el Contacto para historial (Opcional pero recomendado si tu schema lo soporta)
            // En EspoCRM si WhatsappMessage tiene relación \`contact\`, se puede vincular:
            // await this.espoCRMClient.linkEntity('WhatsappMessage', createdMessage.id, 'contact', contactId);
            // Otra opción es actualizar el campo contactId del WhatsappMessage mediante update si existe el campo directo.
            if (conversationId) {
                // Actualizar conversación con último mensaje
                const textPreview = templateContent.substring(0, 100) + '...';
                await this.espoCRMClient.updateEntity('WhatsappConverstion', conversationId, {
                    description: textPreview,
                    fechaHoraUltimoMensaje: new Date().toISOString().slice(0, 19).replace('T', ' '),
                });
            }
        }
        catch (error) {
            console.error('   ❌ Error guardando en WhatsappMessage (el mensaje sí se envió):', error.message);
        }
    }
}
exports.WhatsappInitService = WhatsappInitService;
