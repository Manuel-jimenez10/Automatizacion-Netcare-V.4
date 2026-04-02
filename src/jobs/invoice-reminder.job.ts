import cron from 'node-cron';
import { InvoiceReminderService } from '../services/invoice-reminder.service';

/**
 * Cron Job para el recordatorio automático de prefacturas
 * Se ejecuta todos los días a las 11:00 AM (México)
 */
let started = false;

export const startInvoiceReminderJob = () => {
  // Patrón Singleton para evitar múltiples inits
  if (started) {
    console.log('⚠️ Job de recordatorio de prefacturas ya iniciado. Ignorando llamada.');
    return;
  }
  started = true;

  console.log('🔧 Configurando job de recordatorios de Prefacturas (11:00 AM)...');
  
  // Ejecutar todos los días a las 11:00 AM
  cron.schedule('0 11 * * *', async () => {
    console.log(`\n⏰ [${new Date().toISOString()}] Ejecutando job programado de recordatorio de Prefacturas`);
    
    try {
      const service = new InvoiceReminderService();
      await service.processReminders();
    } catch (error: any) {
      console.error('❌ Error en el job de recordatorio de Prefacturas:', error.message);
      console.error(error.stack);
    }
  }, {
    timezone: 'America/Mexico_City' // Horario México solicitado
  });

  console.log('✅ Job de recordatorios de prefacturas configurado (se ejecutará diariamente a las 11:00 AM hora de México)');
};
