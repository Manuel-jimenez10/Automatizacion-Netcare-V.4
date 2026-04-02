import { Router } from 'express';
import quoteFollowUpRoutes from './quote-followup.routes';
import quotePresentedRoutes from './quote-presented.routes';
import invoiceConfirmedRoutes from './invoice-confirmed.routes';
import invoiceReminderRoutes from './invoice-reminder.routes';
import filesRoutes from './files.routes';
import whatsappRoutes from './whatsapp.routes';
import mediaRoutes from './media.routes';
import whatsappTemplateRoutes from './whatsapp-template.routes';

const router = Router();

router.use('/quotes', quoteFollowUpRoutes);
router.use('/quotes', quotePresentedRoutes);
router.use('/prefacturas', invoiceConfirmedRoutes);
router.use('/prefacturas', invoiceReminderRoutes);
router.use('/files', filesRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/media', mediaRoutes);
router.use('/templates', whatsappTemplateRoutes);

export default router;
