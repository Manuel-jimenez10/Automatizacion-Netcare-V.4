import { Router } from 'express';
import { WhatsappTemplateController } from '../controllers/whatsapp-template.controller';

const router = Router();

// POST /api/templates/send - Workflow de EspoCRM envía el ID del registro por POST
router.post('/send', WhatsappTemplateController.handleSend);

// Flujo alternativo: no usa reporte, recorre todos los Contact con campo phone.
router.post('/send-all-contacts', WhatsappTemplateController.handleSendAllContacts);

// Consulta de progreso del envio asincrono.
router.get('/jobs/:jobId', WhatsappTemplateController.handleGetBulkJob);

export default router;
