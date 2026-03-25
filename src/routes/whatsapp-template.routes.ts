import { Router } from 'express';
import { WhatsappTemplateController } from '../controllers/whatsapp-template.controller';

const router = Router();

// POST /api/templates/send - Workflow de EspoCRM envía el ID del registro por POST
router.post('/send', WhatsappTemplateController.handleSend);

export default router;
