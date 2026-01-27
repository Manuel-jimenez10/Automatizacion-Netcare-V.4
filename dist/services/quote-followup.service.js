"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteFollowUpService = void 0;
const espocrm_api_client_service_1 = require("./espocrm-api-client.service");
const twilio_service_1 = require("./twilio.service");
const env_1 = require("../config/env");
class QuoteFollowUpService {
    constructor() {
        this.espoCRMClient = new espocrm_api_client_service_1.EspoCRMClient();
    }
    /**
     * Proceso principal: Busca y procesa Quotes que necesitan seguimiento
     * - Status: 'Presented'
     * - Fecha de presentación: >= 7 días atrás
     * - No notificadas previamente (followUpSentAt = null)
     */
    async processQuoteFollowUps() {
        console.log('\n🚀 ============================================');
        console.log('🚀 Iniciando proceso de seguimiento de Quotes');
        console.log('🚀 ============================================\n');
        try {
            console.log(`📅 Buscando todas las Quotes en estado 'Presented' para verificar seguimiento...`);
            // 2. Construir filtros para la búsqueda
            const whereFilters = [
                {
                    type: 'and',
                    value: [
                        {
                            type: 'equals',
                            attribute: 'status',
                            value: 'Presented',
                        },
                        // {
                        //   type: 'before',
                        //   attribute: 'datePresented',
                        //   value: dateLimitStr,
                        // },
                        // {
                        //   type: 'isNull',
                        //   attribute: 'followUpSentAt',
                        // },
                    ],
                },
            ];
            // 3. Buscar Quotes que cumplen los criterios
            const quotes = await this.espoCRMClient.searchEntities('Quote', whereFilters);
            if (quotes.length === 0) {
                console.log('ℹ️  No se encontraron Quotes que necesiten seguimiento');
                console.log('\n✅ ============================================');
                console.log('✅ Proceso completado (0 Quotes procesadas)');
                console.log('✅ ============================================\n');
                return;
            }
            console.log(`\n📊 Se encontraron ${quotes.length} Quote(s) para procesar\n`);
            // 4. Procesar cada Quote individualmente
            let successCount = 0;
            let errorCount = 0;
            for (const quote of quotes) {
                try {
                    await this.processQuote(quote);
                    successCount++;
                }
                catch (error) {
                    console.error(`❌ Error procesando Quote ${quote.id}:`, error.message);
                    errorCount++;
                    // Continuar con la siguiente Quote (no detener todo el proceso)
                }
            }
            // 5. Resumen final
            console.log('\n📊 ============================================');
            console.log('📊 RESUMEN DEL PROCESO');
            console.log('📊 ============================================');
            console.log(`   Total Quotes encontradas: ${quotes.length}`);
            console.log(`   ✅ Procesadas exitosamente: ${successCount}`);
            console.log(`   ❌ Con errores: ${errorCount}`);
            console.log('📊 ============================================\n');
        }
        catch (error) {
            console.log('\n❌ ============================================');
            console.log(`❌ Error crítico en el proceso: ${error.message}`);
            console.log('❌ ============================================\n');
            throw error;
        }
    }
    /**
     * Procesa una Quote individual:
     * 1. Obtiene Account asociado
     * 2. Obtiene Billing Contact del Account
     * 3. Extrae y valida teléfono
     * 4. Envía mensaje de WhatsApp
     * 5. Marca Quote como notificada
     */
    async processQuote(quote) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📋 Procesando Quote: "${quote.name}" (ID: ${quote.id})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        // 1. Validar que tiene Contacto de Facturación (Billing Contact)
        // El usuario solicitó explícitamente usar Billing Contact en lugar de Account
        // 1. Validar que tiene Contacto de Facturación (Billing Contact)
        // El usuario solicitó explícitamente usar Billing Contact. Si no existe, error.
        if (!quote.billingContactId) {
            console.log(`⚠️ Advertencia: Quote "${quote.name}" (ID: ${quote.id}) no tiene Billing Contact asociado.`);
            throw new Error(`La Quote "${quote.name}" no tiene un Contacto de Facturación (Billing Contact) asignado. Importante: No se usará la cuenta (Account) como respaldo.`);
        }
        console.log(`🔗 Billing Contact ID: ${quote.billingContactId}`);
        // 2. Obtener Contacto
        const contact = await this.espoCRMClient.getContact(quote.billingContactId);
        // 3. Extraer y validar teléfono desde el CONTACTO
        const phoneValidation = this.extractAndValidatePhone(contact);
        if (!phoneValidation.isValid) {
            throw new Error(`Billing Contact "${contact.name}" no tiene un teléfono válido: ${phoneValidation.error}`);
        }
        console.log(`📞 Teléfono válido (desde Billing Contact): ${phoneValidation.formattedNumber}`);
        // 4. Obtener nombre del cliente
        // Preferimos el nombre del contacto, si no cuenta
        const clientName = contact.name || contact.firstName || 'Cliente';
        console.log(`👤 Cliente: ${clientName}`);
        // Llamar a función auxiliar para continuar (ya que cambié el flujo)
        await this.performQuoteFollowUp(quote, phoneValidation.formattedNumber, clientName);
    }
    // Nueva función auxiliar para completar el envío después de obtener los datos
    async performQuoteFollowUp(quote, phone, clientName) {
        // --- LOGICA DE FECHAS (NUEVA) ---
        const datePresentedStr = quote.datePresented;
        const dateQuotedStr = quote.createdAt;
        const lastWhatsappSentStr = quote.cotizacinEnviadaPorWhatsapp; // Campo custom corregido
        let referenceDate;
        let referenceLabel;
        // 1. Determinar fecha base (Prioridad: WhatsApp enviado > Date Presented > Date Quoted)
        if (lastWhatsappSentStr) {
            referenceDate = new Date(lastWhatsappSentStr);
            referenceLabel = 'Último WhatsApp Enviado';
        }
        else if (datePresentedStr) {
            referenceDate = new Date(datePresentedStr);
            referenceLabel = 'Fecha de Presentación';
        }
        else {
            referenceDate = new Date(dateQuotedStr);
            referenceLabel = 'Fecha de Creación (Date Quoted)';
        }
        // Calcular días pasados
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - referenceDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        console.log(`📅 Referencia: ${referenceLabel} (${referenceDate.toISOString().split('T')[0]})`);
        console.log(`⏳ Días pasados: ${diffDays} (Requerido: >= 7)`);
        if (diffDays < 7) {
            console.log('⏳ Aún no han pasado 7 días. Saltando.');
            return;
        }
        // ---------------------------------
        // --- MANEJO DEL PDF ---
        let pdfUrl;
        const pdfFileId = quote.cotizacinPropuestaId; // Campo corregido
        if (pdfFileId) {
            // Construir URL pública para el PDF (Proxy)
            // Formato: <PUBLIC_URL>/api/files/<FILE_ID>
            pdfUrl = `${env_1.env.publicUrl}/api/files/${pdfFileId}`;
            console.log(`📎 PDF adjunto detectado. ID: ${pdfFileId}`);
            console.log(`📎 URL Pública: ${pdfUrl}`);
        }
        else {
            console.log('⚠️ No hay cotización adjunta (campo cotizacinPropuestaId vacío). Se enviará sin PDF.');
        }
        // ----------------------
        // 7. Enviar mensaje de WhatsApp
        console.log('📱 Enviando mensaje de seguimiento...');
        const twilioResponse = await (0, twilio_service_1.sendQuoteFollowUpMessage)({
            phone: phone,
            clientName: clientName,
            quoteName: quote.name,
            pdfUrl: pdfUrl,
        });
        // 8. Guardar mensaje en WhatsappMessage (EspoCRM)
        console.log('💾 Guardando mensaje de seguimiento en WhatsappMessage...');
        try {
            // Buscar o crear conversación
            let conversationId = '';
            // USER REQUEST: verificaremos si ya existe una conversacion con el numero de telefono
            // del receptor del mensaje en el campo 'contact' (Link) o 'name' (Phone)
            // Como standard EspoCRM usa 'name' para el número en conversciones whatsapp, buscamos por 'name'.
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
                    description: `Conversación de seguimiento de cotización`
                };
                // USER REQUEST: si no existe, cuando se cree, el campo contact de whatsapp conversation, 
                // debe almacenar el Name del billing contact
                if (quote.billingContactName) {
                    // Si 'contact' es un campo de texto simple:
                    conversationPayload.contact = quote.billingContactName;
                    // Si 'contact' es un Link al Contacto (lo más probable en EspoCRM):
                    // Intentaremos setear el Link también si tenemos ID
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
                name: senderPhone, // EspoCRM suele requerir Name
                contact: senderPhone, // USER REQUEST: Guardar número del sender en campo 'contact'
                status: 'Sent', // FIX: Marcarlo como Enviado de una vez para evitar re-proceso 
                type: 'Out',
                description: twilioResponse.body || `Seguimiento de cotización: ${quote.name}`,
                whatsappConverstionId: conversationId, // CORREGIDO: Ajustado al typo de la entidad (Converstion)
                messageSid: twilioResponse.sid,
                isRead: false
            };
            // Vincular con Contacto (Billing Contact) -> Usamos contactId para la Relación
            if (quote.billingContactId) {
                messagePayload.contactId = quote.billingContactId;
            }
            // USER REQUEST: solo a mensajes salientes, agregar campo Quote con ID de cotizacion
            // Asumimos campo 'quoteId' (Link) y 'quoteName' (posiblemente)
            messagePayload.quoteId = quote.id;
            messagePayload.quoteName = quote.name;
            await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
            console.log(`✅ Mensaje guardado en WhatsappMessage con SID: ${twilioResponse.sid}`);
            // Actualizar conversación con último mensaje
            await this.espoCRMClient.updateEntity('WhatsappConverstion', conversationId, {
                description: `Seguimiento de cotización: ${quote.name}`,
                fechaHoraUltimoMensaje: new Date().toISOString().slice(0, 19).replace('T', ' '),
            });
        }
        catch (error) {
            console.error('❌ Error guardando mensaje en WhatsappMessage:', error.message);
            // No lanzar error - el mensaje ya se envió exitosamente
        }
        // 9. Actualizar fecha de último envío
        const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        console.log(`📝 Actualizando 'cotizacinEnviadaPorWhatsapp' a: ${today}`);
        await this.espoCRMClient.updateEntity('Quote', quote.id, {
            cotizacinEnviadaPorWhatsapp: today,
        });
        console.log(`✅ Quote "${quote.name}" procesada exitosamente`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
    /**
     * Extrae y valida el número de teléfono de un contacto
     * Reutiliza la misma lógica del servicio de Tasks
     */
    extractAndValidatePhone(entity) {
        console.log('🔍 Buscando número de teléfono en el contacto...');
        // Posibles campos donde puede estar el teléfono
        const phoneFields = ['phoneNumber', 'phoneMobile', 'phoneOffice', 'phone'];
        let phone;
        let fieldFound;
        // Buscar el primer campo con un valor
        for (const field of phoneFields) {
            if (entity[field]) {
                phone = entity[field];
                fieldFound = field;
                console.log(`   ✓ Teléfono encontrado en campo: ${field}`);
                break;
            }
        }
        // Validar que se encontró un teléfono
        if (!phone) {
            return {
                isValid: false,
                error: `No se encontró número de teléfono. Campos revisados: ${phoneFields.join(', ')}`,
            };
        }
        // Limpiar el número (quitar espacios, guiones, paréntesis)
        let cleanedPhone = phone.replace(/[\s\-\(\)]/g, '');
        // Validar que no esté vacío después de limpiar
        if (!cleanedPhone) {
            return {
                isValid: false,
                error: 'El número de teléfono está vacío después de limpiarlo',
            };
        }
        // Asegurar que tenga código de país (+)
        if (!cleanedPhone.startsWith('+')) {
            cleanedPhone = `+${cleanedPhone}`;
        }
        // Validar longitud mínima (al menos 10 dígitos sin contar el +)
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
    /**
     * Obtiene el nombre del cliente
     * Reutiliza la misma lógica del servicio de Tasks
     */
    getClientName(entity) {
        // Si tiene campo "name", usarlo directamente
        if (entity.name) {
            return entity.name;
        }
        // Si tiene firstName y lastName, combinarlos
        if (entity.firstName || entity.lastName) {
            const firstName = entity.firstName || '';
            const lastName = entity.lastName || '';
            return `${firstName} ${lastName}`.trim();
        }
        // Fallback: usar el ID de la entidad
        return entity.id || 'Cliente';
    }
}
exports.QuoteFollowUpService = QuoteFollowUpService;
