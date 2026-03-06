import { Router } from 'express';
import { QuotePresentedController } from '../controllers/quote-presented.controller';

const router = Router();

// POST /api/quotes/presented - Webhook para cuando una Quote cambia a Presented
router.post('/presented', QuotePresentedController.handlePresented);

export default router;
