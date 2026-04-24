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
    async handleInitConversation(contactId, messageEntityId, existingConversationId) {
        console.log('\n🚀 ============================================');
        console.log(`🚀 Iniciando WhatsApp de apertura para el Contacto ID: ${contactId}`);
        if (messageEntityId)
            console.log(`   📋 WhatsappMessage origen ID: ${messageEntityId}`);
        if (existingConversationId)
            console.log(`   💬 Conversación origen ID: ${existingConversationId}`);
        console.log('🚀 ============================================\n');
        try {
            // 1. Obtener la información del Contacto
            const contact = await this.espoCRMClient.getContact(contactId);
            // Validar teléfono
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
            console.log(`📞 Teléfono validado: ${validPhone}`);
            // 2. Preparar el contenido del template para registrar en EspoCRM
            const templateContent = `Hola ${contact.name}.\nRecibimos tu contacto para información sobre nuestros servicios en Netcare MX.\n\nPodemos apoyarte en automatización de portones, accesos, cámaras y soluciones tecnológicas.\n\nSi deseas que continuemos por WhatsApp, respóndenos a este mensaje y te atendemos de inmediato.`;
            // 3. Enviar template por Twilio
            const contentVariables = {
                '1': contact.name,
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
            await this.logMessageInEspo(validPhone, contact.name, contactId, templateContent, twilioResponse, messageEntityId, existingConversationId);
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
    /**
     * Busca la conversación existente de forma robusta:
     * 1. Usa el conversationId directo si viene del webhook
     * 2. Si viene el messageEntityId, obtiene la conversación del WhatsappMessage original
     * 3. Fallback: busca por contactId en la conversación
     * 4. Fallback: busca por teléfono (fuzzy matching como el handler entrante)
     */
    async findExistingConversation(phone, contactId, messageEntityId, existingConversationId) {
        // 1. Si el webhook nos envió el conversationId directamente, usarlo
        if (existingConversationId) {
            console.log(`   💬 Usando conversación del webhook: ${existingConversationId}`);
            return existingConversationId;
        }
        // 2. Si tenemos el ID del WhatsappMessage que disparó el workflow, obtener su conversación
        if (messageEntityId) {
            try {
                console.log(`   🔍 Buscando conversación desde WhatsappMessage: ${messageEntityId}`);
                const originalMessage = await this.espoCRMClient.getEntity('WhatsappMessage', messageEntityId);
                if (originalMessage.whatsappConverstionId) {
                    console.log(`   ✅ Conversación encontrada via mensaje original: ${originalMessage.whatsappConverstionId}`);
                    return originalMessage.whatsappConverstionId;
                }
            }
            catch (err) {
                console.warn(`   ⚠️ No se pudo obtener WhatsappMessage ${messageEntityId}: ${err.message}`);
            }
        }
        // 3. Buscar conversación por contactId
        console.log(`   🔍 Buscando conversación por contactId: ${contactId}`);
        let conversations = await this.espoCRMClient.searchEntities('WhatsappConverstion', [
            {
                type: 'equals',
                attribute: 'contactId',
                value: contactId,
            },
        ]);
        if (conversations.length > 0) {
            console.log(`   ✅ Conversación encontrada por contactId: ${conversations[0].id}`);
            return conversations[0].id;
        }
        // 4. Fallback: buscar por teléfono con matching flexible (como el handler de mensajes entrantes)
        const normalizedPhone = phone.replace(/\D/g, '');
        const last7 = normalizedPhone.slice(-7);
        console.log(`   🔍 Buscando conversación por teléfono (últimos 7 dígitos: ${last7})`);
        conversations = await this.espoCRMClient.searchEntities('WhatsappConverstion', [
            {
                type: 'contains',
                attribute: 'name',
                value: last7,
            },
        ]);
        // Filtrado post-búsqueda para evitar falsos positivos
        const filtered = conversations.filter(c => {
            const cPhone = c.name.replace(/\D/g, '');
            return cPhone.endsWith(normalizedPhone) || normalizedPhone.endsWith(cPhone);
        });
        if (filtered.length > 0) {
            console.log(`   ✅ Conversación encontrada por teléfono: ${filtered[0].id}`);
            return filtered[0].id;
        }
        console.log(`   ℹ️ No se encontró conversación existente para ${phone}`);
        return null;
    }
    async logMessageInEspo(phone, contactName, contactId, templateContent, twilioResponse, messageEntityId, existingConversationId) {
        console.log('   💾 Guardando mensaje de apertura en WhatsappMessage...');
        try {
            // Buscar conversación existente de forma robusta
            let conversationId = await this.findExistingConversation(phone, contactId, messageEntityId, existingConversationId);
            if (!conversationId) {
                // Crear nueva conversación si no existe ninguna
                console.log(`   ✨ Creando nueva conversación para: ${phone}`);
                const newConversation = await this.espoCRMClient.createEntity('WhatsappConverstion', {
                    name: phone,
                    contactId: contactId,
                });
                conversationId = newConversation.id;
            }
            // Si tenemos el ID del WhatsappMessage que disparó el workflow,
            // ACTUALIZAMOS ese registro en vez de crear uno nuevo (evita duplicados)
            const messagePayload = {
                name: phone, // Teléfono del destinatario
                contact: phone, // Campo contact en EspoCRM  
                contactId: contactId, // Vincular con el Contact
                status: 'Sent',
                type: 'Out',
                description: templateContent,
                messageSid: twilioResponse.sid,
                isRead: false,
            };
            if (conversationId) {
                messagePayload.whatsappConverstionId = conversationId;
            }
            if (messageEntityId) {
                // ACTUALIZAR el registro existente (el que disparó el workflow)
                await this.espoCRMClient.updateEntity('WhatsappMessage', messageEntityId, messagePayload);
                console.log(`   ✅ WhatsappMessage actualizado (ID: ${messageEntityId}) — sin duplicados`);
            }
            else {
                // Fallback: crear nuevo registro si no tenemos el ID original
                const createdMessage = await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
                console.log(`   ✅ Mensaje nuevo creado en WhatsappMessage (ID: ${createdMessage.id})`);
            }
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
