import { Router } from 'express';
import { AdminNotificationController } from '../controllers/admin-notification.controller';

const router = Router();

// Workflow de EspoCRM: se creó un WhatsappMessage entrante
router.post('/whatsapp-message', AdminNotificationController.handleCrmMessage);

// StatusCallback de Twilio para las notificaciones internas (sin secreto:
// lo llama Twilio y solo escribe en el log)
router.post('/status-callback', AdminNotificationController.handleStatusCallback);

// Diagnóstico y mantenimiento
router.get('/status', AdminNotificationController.getStatus);
router.post('/test', AdminNotificationController.handleTest);
router.post('/reset', AdminNotificationController.handleReset);

export default router;
