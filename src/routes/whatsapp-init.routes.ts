import { Router } from 'express';
import multer from 'multer';
import { WhatsappInitController } from '../controllers/whatsapp-init.controller';

const router = Router();
const upload = multer(); // Para parsear multipart/form-data de EspoCRM

// POST /api/whatsapp-init/send - Workflow de EspoCRM envía el contactId
// EspoCRM envía webhooks como multipart/form-data, por eso usamos upload.none()
router.post('/send', upload.none(), WhatsappInitController.handleInit);

export default router;
