import { Router } from 'express';
import { InvoiceReminderController } from '../controllers/invoice-reminder.controller';

const router = Router();

// GET /api/prefacturas/run-reminders - Ejecutar manualmente recordatorios
router.get('/run-reminders', InvoiceReminderController.runReminders);

export default router;
