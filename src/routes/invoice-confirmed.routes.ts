import { Router } from 'express';
import { InvoiceConfirmedController } from '../controllers/invoice-confirmed.controller';

const router = Router();

// POST /api/invoices/confirmed - Webhook para cuando una Prefactura cambia a Confirmed
router.post('/confirmed', InvoiceConfirmedController.handleConfirmed);

export default router;
