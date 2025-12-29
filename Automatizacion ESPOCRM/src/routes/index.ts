import { Router } from 'express';
import webhookRoutes from './webhook.routes';
import testRoutes from './test.routes';
import quoteFollowUpRoutes from './quote-followup.routes';
import filesRoutes from './files.routes';

const router = Router();

router.use('/webhooks', webhookRoutes);
router.use('/test', testRoutes); // 🧪 Rutas de prueba
router.use('/quotes', quoteFollowUpRoutes); // 📋 Rutas de seguimiento de Quotes
router.use('/files', filesRoutes); // 📂 Rutas para servir archivos

export default router;

