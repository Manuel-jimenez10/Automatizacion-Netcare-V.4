import { Router } from 'express';
import { WhatsappController } from '../controllers/whatsapp.controller';

const router = Router();

// Twilio Webhook (Incoming Messages)
router.post('/incoming', WhatsappController.handleIncomingMessage);

// EspoCRM Webhook (Outgoing Messages - Workflow Trigger)
router.post('/outgoing', WhatsappController.handleOutgoingMessage);

// Twilio Status Callback
router.post('/status', WhatsappController.handleStatusUpdate);

export default router;
