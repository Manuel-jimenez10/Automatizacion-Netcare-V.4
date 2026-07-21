"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappTemplateController = void 0;
const whatsapp_template_service_1 = require("../services/whatsapp-template.service");
const whatsapp_bulk_job_service_1 = require("../services/whatsapp-bulk-job.service");
class WhatsappTemplateController {
    /**
     * Endpoint para manejar el envío de templates dinámicos.
     * POST /api/templates/send
     * Body: { "id": "..." } o { "templateId": "..." }
     *
     * El workflow de EspoCRM envía el ID del registro WhatsappTemplate por POST.
     */
    static async handleSend(req, res) {
        try {
            console.log('📨 Evento recibido: Envío de Template dinámico');
            console.log('   Body:', req.body);
            // EspoCRM envía { id: '...' }, pero aceptamos ambos por compatibilidad
            const templateRecordId = req.body.templateId || req.body.id;
            if (!templateRecordId) {
                console.error('❌ Error: id no proporcionado en el body');
                res.status(400).json({
                    success: false,
                    message: 'templateId o id es requerido en el body',
                });
                return;
            }
            const service = new whatsapp_template_service_1.WhatsappTemplateService();
            const result = await service.handleTemplateSend(templateRecordId);
            res.status(200).json({
                success: true,
                message: 'Proceso de envío de template completado',
                data: result,
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            console.error('❌ Error en handleSend:', error.message);
            res.status(500).json({
                success: false,
                message: 'Error al procesar el envío del template',
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    }
    /**
     * Encola el envio del template a todos los Contact con `phone`.
     * Responde 202 sin esperar a que termine la campana completa.
     *
     * POST /api/templates/send-all-contacts
     * Body: { "id": "..." } o { "templateId": "..." }
     */
    static handleSendAllContacts(req, res) {
        const templateRecordId = req.body.templateId || req.body.id;
        if (!templateRecordId || typeof templateRecordId !== 'string') {
            res.status(400).json({
                success: false,
                message: 'templateId o id es requerido en el body',
            });
            return;
        }
        const { job, reused } = whatsapp_bulk_job_service_1.whatsappBulkJobManager.enqueue(templateRecordId);
        res.status(202).json({
            success: true,
            message: reused
                ? 'Ya existe un envio activo para este template'
                : 'Envio a todos los contactos encolado correctamente',
            data: {
                jobId: job.id,
                status: job.status,
                reused,
                statusUrl: `/api/templates/jobs/${job.id}`,
            },
            timestamp: new Date().toISOString(),
        });
    }
    /** GET /api/templates/jobs/:jobId */
    static handleGetBulkJob(req, res) {
        const job = whatsapp_bulk_job_service_1.whatsappBulkJobManager.getJob(req.params.jobId);
        if (!job) {
            res.status(404).json({
                success: false,
                message: 'Trabajo de envio no encontrado o expirado',
            });
            return;
        }
        res.status(200).json({
            success: true,
            data: job,
            timestamp: new Date().toISOString(),
        });
    }
}
exports.WhatsappTemplateController = WhatsappTemplateController;
