import cron from 'node-cron';
import { QuoteFollowUpService } from '../services/quote-followup.service';

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
export const startQuoteFollowUpJob = () => {
  console.log('🔧 Configurando job de seguimiento de Quotes...');
  
  // Ejecutar todos los días a las 09:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log(`\n⏰ [${new Date().toISOString()}] Ejecutando job programado de seguimiento de Quotes`);
    
    try {
      const service = new QuoteFollowUpService();
      await service.processQuoteFollowUps();
    } catch (error: any) {
      console.error('❌ Error en el job de seguimiento de Quotes:', error.message);
      console.error(error.stack);
    }
  }, {
    timezone: 'America/Mexico_City' // Ajusta según tu zona horaria
  });

  console.log('✅ Job de seguimiento de Quotes configurado (se ejecutará diariamente a las 09:00 AM)');
};
