"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceReminderService = void 0;
const axios_1 = __importDefault(require("axios"));
const espocrm_api_client_service_1 = require("./espocrm-api-client.service");
const twilio_service_1 = require("./twilio.service");
const env_1 = require("../config/env");
const phone_utils_1 = require("../utils/phone-utils");
// ID del reporte de pagos pendientes en EspoCRM
const REPORT_ID = '63bdf048f34838646';
class InvoiceReminderService {
    constructor() {
        this.espoCRMClient = new espocrm_api_client_service_1.EspoCRMClient();
    }
    /**
     * Proceso principal: Exporta el reporte de pagos pendientes,
     * obtiene los IDs, consulta cada Invoice completa y procesa los recordatorios.
     * FUENTE DE DATOS: Reporte EspoCRM ID 63bdf048f34838646
     */
    async processReminders(testMode = false) {
        console.log('\n🚀 ============================================');
        console.log('🚀 Iniciando proceso de Recordatorios de Prefacturas');
        console.log(`🚀 Fuente: Reporte ID ${REPORT_ID}`);
        if (testMode)
            console.log('🧪 MODO PRUEBA: Solo se enviará a billing contact "prueba seguimiento"');
        console.log('🚀 ============================================\n');
        try {
            // 1. Exportar reporte como CSV y extraer SOLO los IDs
            const invoiceIds = await this.getInvoiceIdsFromReport();
            if (invoiceIds.length === 0) {
                console.log('ℹ️  No se encontraron Prefacturas en el reporte de pagos pendientes');
                return;
            }
            console.log(`\n📊 Se encontraron ${invoiceIds.length} Prefactura(s) en el reporte\n`);
            let sentCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            for (const invoiceId of invoiceIds) {
                try {
                    // 2. Obtener la Invoice completa desde la API
                    console.log(`\n🔍 Obteniendo Invoice completa: ${invoiceId}`);
                    const invoice = await this.espoCRMClient.getEntity('Invoice', invoiceId);
                    // 3. Procesar recordatorio
                    const result = await this.processInvoiceReminder(invoice, testMode);
                    if (result === 'sent') {
                        sentCount++;
                    }
                    else {
                        skippedCount++;
                    }
                }
                catch (error) {
                    console.error(`❌ Error procesando Prefactura ${invoiceId}:`, error.message);
                    errorCount++;
                }
            }
            console.log('\n📊 ============================================');
            console.log('📊 RESUMEN DEL PROCESO DE RECORDATORIOS (PREFACTURAS)');
            console.log('📊 ============================================');
            console.log(`   Total Prefacturas en reporte: ${invoiceIds.length}`);
            console.log(`   ✅ Mensajes enviados: ${sentCount}`);
            console.log(`   ⏳ Saltadas (no aplican hoy): ${skippedCount}`);
            console.log(`   ❌ Con errores: ${errorCount}`);
            console.log('📊 ============================================\n');
        }
        catch (error) {
            console.error('\n❌ Error crítico en el proceso de recordatorios:', error.message);
            throw error;
        }
    }
    /**
     * Exporta el reporte de pagos pendientes como CSV y extrae SOLO los IDs.
     * El ID siempre es la primera columna del CSV, así que no hay riesgo de parsing.
     */
    async getInvoiceIdsFromReport() {
        console.log(`📄 Exportando reporte ${REPORT_ID} a CSV...`);
        // 1. Exportar el reporte
        const exportResponse = await this.espoCRMClient.request('POST', 'Report/action/exportList', { id: REPORT_ID, format: 'csv' });
        const attachmentId = exportResponse.id;
        console.log(`   ✓ CSV generado. Attachment ID: ${attachmentId}`);
        // 2. Descargar el CSV
        let baseUrl = env_1.env.espocrmBaseUrl;
        baseUrl = baseUrl.replace(/\/api\/v1\/?$/, '');
        baseUrl = baseUrl.replace(/\/$/, '');
        const downloadUrl = `${baseUrl}/?entryPoint=download&id=${attachmentId}`;
        console.log(`   📥 Descargando CSV...`);
        const downloadResponse = await axios_1.default.get(downloadUrl, {
            headers: { 'X-Api-Key': env_1.env.espocrmApiKey },
            responseType: 'arraybuffer',
        });
        const csvContent = Buffer.from(downloadResponse.data).toString('utf-8');
        // 3. Extraer solo los IDs (primera columna, separador ;)
        const lines = csvContent.split('\n').filter((l) => l.trim() !== '');
        if (lines.length < 2) {
            console.log('⚠️ El reporte no tiene filas de datos.');
            return [];
        }
        // Verificar que la primera columna sea "id"
        const firstHeader = lines[0].split(';')[0];
        if (firstHeader !== 'id') {
            console.warn(`⚠️ La primera columna del CSV es "${firstHeader}", se esperaba "id". Continuando de todas formas...`);
        }
        const ids = [];
        for (let i = 1; i < lines.length; i++) {
            const id = lines[i].split(';')[0].replace(/^"|"$/g, '').trim();
            if (id) {
                ids.push(id);
            }
        }
        console.log(`   ✅ ${ids.length} IDs extraídos del reporte`);
        return ids;
    }
    /**
     * Evalúa y procesa una prefactura individual (ya obtenida completa de la API)
     */
    async processInvoiceReminder(invoice, testMode = false) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📋 Evaluando Prefactura: "${invoice.name}" (ID: ${invoice.id})`);
        // MODO PRUEBA: solo enviar al contacto de prueba
        if (testMode && invoice.billingContactName !== 'prueba seguimiento') {
            console.log(`🧪 MODO PRUEBA: Saltando (billing contact: "${invoice.billingContactName || 'N/A'}" ≠ "prueba seguimiento")`);
            return 'skipped';
        }
        if (!invoice.fechaLimiteDePago) {
            console.log('⏳ No tiene fecha límite de pago. Saltando.');
            return 'skipped';
        }
        // Calcular días restantes
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const limitDate = new Date(invoice.fechaLimiteDePago + 'T00:00:00');
        const diffTime = limitDate.getTime() - today.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        console.log(`📅 Fecha límite: ${invoice.fechaLimiteDePago}`);
        console.log(`⏳ Días restantes: ${diffDays}`);
        let templateSidToUse = '';
        let isReminder3Days = false;
        let isOverdue = false;
        // LÓGICA DE ENVÍO:
        // 3 días para cobrar (diffDays == 3) => template HX8411c416243fbc6f65ad9fa949ac531c
        // día de vencimiento o posterior (diffDays <= 0) => template HX4936804ea67041afabf8a23695fde93c
        if (diffDays === 3 && !invoice.recordatorio3DiasEnviado) {
            console.log('🔔 ¡Corresponde RECORDATORIO de 3 DÍAS!');
            templateSidToUse = env_1.env.prefacturaReminder3DaysSid;
            isReminder3Days = true;
        }
        else if (diffDays <= 0 && !invoice.avisoVencimientoEnviado) {
            console.log('⚠️ ¡Corresponde AVISO DE VENCIMIENTO (día 0 o posterior)!');
            templateSidToUse = env_1.env.prefacturaReminderOverdueSid;
            isOverdue = true;
        }
        else {
            let reason = `Días restantes: ${diffDays}. No aplica ninguna regla.`;
            if (diffDays === 3 && invoice.recordatorio3DiasEnviado)
                reason = `Ya se envió recordatorio de 3 días el ${invoice.recordatorio3DiasEnviado}`;
            if (diffDays <= 0 && invoice.avisoVencimientoEnviado)
                reason = `Ya se envió aviso de vencimiento el ${invoice.avisoVencimientoEnviado}`;
            console.log(`⏳ Omitiendo: ${reason}`);
            return 'skipped';
        }
        // 1. Validar que tiene Contacto de Facturación
        if (!invoice.billingContactId) {
            throw new Error(`La Prefactura "${invoice.name}" no tiene Billing Contact asignado.`);
        }
        // 2. Obtener Contacto y validar teléfono
        console.log(`🔗 Billing Contact ID: ${invoice.billingContactId} (${invoice.billingContactName})`);
        const contact = await this.espoCRMClient.getContact(invoice.billingContactId);
        const phoneValidation = (0, phone_utils_1.extractAndValidatePhone)(contact);
        if (!phoneValidation.isValid) {
            throw new Error(`Billing Contact "${contact.name}" no tiene un teléfono válido: ${phoneValidation.error}`);
        }
        console.log(`📞 Teléfono válido: ${phoneValidation.formattedNumber}`);
        const clientName = contact.name || contact.firstName || 'Cliente';
        // 3. Validar PDF adjunto
        if (!invoice.prefacturaAdjuntaId) {
            throw new Error(`La Prefactura "${invoice.name}" no tiene PDF adjunto (campo prefacturaAdjunta).`);
        }
        const pdfUrl = `${env_1.env.publicUrl}/api/files/${invoice.prefacturaAdjuntaId}`;
        console.log(`📎 PDF ID: ${invoice.prefacturaAdjuntaId}`);
        console.log(`📎 PDF URL: ${pdfUrl}`);
        // 4. Enviar mensaje por Twilio
        console.log('📱 Enviando WhatsApp...');
        const twilioResponse = await (0, twilio_service_1.sendPrefacturaReminderMessage)({
            phone: phoneValidation.formattedNumber,
            clientName,
            invoiceName: invoice.name,
            fechaLimiteDePago: invoice.fechaLimiteDePago,
            pdfUrl,
            templateSid: templateSidToUse,
            isOverdue,
        });
        // 5. Marcar como enviado en EspoCRM (DateTime format: YYYY-MM-DD HH:MM:SS)
        const nowDateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const updatePayload = {};
        if (isReminder3Days)
            updatePayload.recordatorio3DiasEnviado = nowDateTime;
        if (isOverdue)
            updatePayload.avisoVencimientoEnviado = nowDateTime;
        console.log(`📝 Actualizando Invoice con campos de control (DateTime):`, updatePayload);
        await this.espoCRMClient.updateEntity('Invoice', invoice.id, updatePayload);
        // 6. Guardar registro en EspoCRM (WhatsappMessage)
        await this.logMessageInEspo(invoice, phoneValidation.formattedNumber, twilioResponse);
        console.log(`✅ Prefactura "${invoice.name}" procesada exitosamente`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        // Pausa de 1.5s entre envíos (prevención de rate-limit de Twilio con archivos media)
        console.log('⏱️ Pausando 1.5s antes del siguiente envío...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        return 'sent';
    }
    /**
     * Registra el mensaje enviado en WhatsappMessage y WhatsappConverstion
     */
    async logMessageInEspo(invoice, phone, twilioResponse) {
        console.log('💾 Guardando mensaje en WhatsappMessage...');
        try {
            let conversationId = '';
            const conversations = await this.espoCRMClient.searchEntities('WhatsappConverstion', [
                { type: 'equals', attribute: 'name', value: phone }
            ]);
            if (conversations.length > 0) {
                conversationId = conversations[0].id;
                console.log(`✅ Conversación existente encontrada: ${conversationId}`);
            }
            else {
                console.log(`✨ Creando nueva conversación para ${phone}`);
                const conversationPayload = {
                    name: phone,
                    description: `Conversación iniciada por Recordatorio de Prefactura`
                };
                if (invoice.billingContactName) {
                    conversationPayload.contact = invoice.billingContactName;
                    if (invoice.billingContactId)
                        conversationPayload.contactId = invoice.billingContactId;
                }
                const newConv = await this.espoCRMClient.createEntity('WhatsappConverstion', conversationPayload);
                conversationId = newConv.id;
            }
            const senderPhone = env_1.env.twilioWhatsappFrom.replace('whatsapp:', '');
            const messagePayload = {
                name: senderPhone,
                contact: senderPhone,
                status: 'Sent',
                type: 'Out',
                description: `Recordatorio automático - Prefactura: ${invoice.name}`,
                whatsappConverstionId: conversationId,
                messageSid: twilioResponse.sid,
                isRead: false
            };
            if (invoice.billingContactId) {
                messagePayload.contactId = invoice.billingContactId;
            }
            await this.espoCRMClient.createEntity('WhatsappMessage', messagePayload);
            console.log(`✅ WhatsappMessage creado con SID: ${twilioResponse.sid}`);
            await this.espoCRMClient.updateEntity('WhatsappConverstion', conversationId, {
                description: `Recordatorio automático - Prefactura: ${invoice.name}`,
                fechaHoraUltimoMensaje: new Date().toISOString().slice(0, 19).replace('T', ' '),
            });
        }
        catch (error) {
            console.error('❌ Error guardando en WhatsappMessage (el mensaje SÍ se envió):', error.message);
        }
    }
}
exports.InvoiceReminderService = InvoiceReminderService;
