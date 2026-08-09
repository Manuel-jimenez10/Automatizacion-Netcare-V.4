import { Router } from 'express';
import { QuoteFollowUpController } from '../controllers/quote-followup.controller';

const router = Router();

// Ejecutar el ciclo de seguimiento. ?dryRun=true simula sin enviar.
// Se mantiene GET por compatibilidad con los accesos manuales existentes.
router.post('/run-followup', QuoteFollowUpController.runFollowUp);
router.get('/run-followup', QuoteFollowUpController.runFollowUp);

// Resultado de la última ejecución (manual o por cron)
router.get('/followup-status', QuoteFollowUpController.getStatus);

export default router;
