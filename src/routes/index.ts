import { Router } from 'express';
import quoteFollowUpRoutes from './quote-followup.routes';
import testRoutes from './test.routes';
import webhookRoutes from './webhook.routes';
import filesRoutes from './files.routes';
import whatsappRoutes from './whatsapp.routes';
import mediaRoutes from './media.routes';

const router = Router();

router.use('/webhooks', webhookRoutes);
router.use('/test', testRoutes);
router.use('/quotes', quoteFollowUpRoutes);
router.use('/files', filesRoutes);
router.use('/whatsapp', whatsappRoutes);
router.use('/media', mediaRoutes);

export default router;
