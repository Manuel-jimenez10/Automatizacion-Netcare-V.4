import { Router } from 'express';
import { testWhatsApp } from '../controllers/test.controller';

const router = Router();

// 🧪 Ruta de prueba - NO requiere EspoCRM
router.get('/send-whatsapp', testWhatsApp);

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
