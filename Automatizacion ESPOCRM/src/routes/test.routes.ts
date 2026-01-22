import { Router } from 'express';
import { testWhatsApp, testTemplateMessage } from '../controllers/test.controller';

const router = Router();

// 🧪 Ruta de prueba - Mensaje simple SIN template
router.get('/send-whatsapp', testWhatsApp);

// 🧪 Ruta de prueba - Mensaje CON template
router.get('/test-template', testTemplateMessage);

// 🚀 Ruta para disparar el Job manualmente
router.get('/trigger-job', async (_req, res) => {
  try {
    const { QuoteFollowUpService } = await import('../services/quote-followup.service');
    const service = new QuoteFollowUpService();
    
    // Ejecutar en segundo plano para no bloquear
    service.processQuoteFollowUps().catch(err => console.error(err));
    
    res.json({ message: 'Job iniciado manualmenet. Revisa la consola.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
