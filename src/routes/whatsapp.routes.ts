import { Router } from 'express';
import { WhatsappController } from '../controllers/whatsapp.controller';
import { WhatsappInfoController } from '../controllers/whatsapp-info.controller';

const router = Router();

// Twilio Webhook (Incoming Messages)
router.post('/incoming', WhatsappController.handleIncomingMessage);

// EspoCRM Webhook (Outgoing Messages - Workflow Trigger)
router.post('/outgoing', WhatsappController.handleOutgoingMessage);

// Twilio Status Callback
router.post('/status', WhatsappController.handleStatusUpdate);

// EspoCRM Webhook (Mensaje informativo al cliente - checkbox del agente)
router.post('/send-info', WhatsappInfoController.handleSendInfo);

export default router;
