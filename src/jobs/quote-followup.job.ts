import cron from 'node-cron';
import { QuoteFollowUpService } from '../services/quote-followup.service';
import { QuoteFollowUpController } from '../controllers/quote-followup.controller';

/**
 * Cron Job para el seguimiento automático de Quotes
 * Se ejecuta todos los días a las 09:00 AM
 * 
 * Patrón cron: '0 9 * * *'
 * - Minuto: 0
 * - Hora: 9 (09:00 AM)
 * - Día del mes: * (cualquier día)
 * - Mes: * (cualquier mes)
 * - Día de la semana: * (cualquier día)
 */
let started = false;

export const startQuoteFollowUpJob = () => {
  // Patrón Singleton para evitar múltiples inits si Passenger hace spawn
  if (started) {
    console.log('⚠️ Job de seguimiento ya iniciado. Ignorando llamada.');
    return;
  }
  started = true;

  console.log('🔧 Configurando job de seguimiento de Quotes...');
  
  // Ejecutar todos los días a las 09:00 AM
  cron.schedule('0 9 * * *', async () => {
    const startedAt = new Date().toISOString();
    console.log(`\n⏰ [${startedAt}] Ejecutando job programado de seguimiento de Quotes`);

    // Mismo candado que el endpoint manual: si alguien lo lanzó a mano a las
    // 09:00, las dos ejecuciones leerían el mismo contador y duplicarían envíos.
    if (!QuoteFollowUpController.tryAcquire()) {
      console.log('⚠️ Ya hay un proceso de seguimiento en curso. Se omite esta ejecución.');
      return;
    }

    try {
      const service = new QuoteFollowUpService();
      const result = await service.processQuoteFollowUps();
      QuoteFollowUpController.recordCronRun(result, startedAt);
    } catch (error: any) {
      console.error('❌ Error en el job de seguimiento de Quotes:', error.message);
      console.error(error.stack);
      QuoteFollowUpController.recordCronError(error.message);
    } finally {
      QuoteFollowUpController.release();
    }
  }, {
    timezone: 'America/Mexico_City' // Ajusta según tu zona horaria
  });

  console.log('✅ Job de seguimiento de Quotes configurado (se ejecutará diariamente a las 09:00 AM)');
};
