import { Router } from 'express';
import { QuoteFollowUpController } from '../controllers/quote-followup.controller';

const router = Router();

// POST /api/quotes/run-followup - Ejecutar manualmente el proceso de seguimiento
router.post('/run-followup', QuoteFollowUpController.runFollowUp);

export default router;
