import path from 'path';
import app from './app';

// 1. Cargar .env EXPLÍCITAMENTE
// Passenger no hereda el entorno del shell, así que necesitamos la ruta absoluta.
import dotenv from 'dotenv';
dotenv.config({
  path: path.resolve('/home/nc/api-express-espocrm/.env')
});

// 2. EXPORTAR LA APP INMEDIATAMENTE
// Passenger espera que el require() retorne la app SIN BLOQUEOS
export = app;

// 3. INICIAR PROCESOS SECUNDARIOS (Jobs, etc.)
// Usamos process.nextTick o setImmediate para que esto ocurra
// DESPUÉS de que Passenger haya recibido la app.
process.nextTick(() => {
  try {
    console.log('🕒 Inicializando cron job (diferido)...');
    
    // Importación dinámica para evitar efectos secundarios al inicio
    const { startQuoteFollowUpJob } = require('./jobs/quote-followup.job');

    startQuoteFollowUpJob();
  } catch (err) {
    console.error('❌ Cron init error:', err);
  }
});
