"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const path_1 = __importDefault(require("path"));
const app_1 = __importDefault(require("./app"));
// 1. Cargar .env EXPLÍCITAMENTE
// Passenger no hereda el entorno del shell, así que necesitamos la ruta absoluta.
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({
    path: path_1.default.resolve('/home/nc/api-express-espocrm/.env')
});
// 3. INICIAR PROCESOS SECUNDARIOS (Jobs, etc.)
// Usamos process.nextTick o setImmediate para que esto ocurra
// DESPUÉS de que Passenger haya recibido la app.
process.nextTick(() => {
    try {
        console.log('🕒 Inicializando cron job (diferido)...');
        // Importación dinámica para evitar efectos secundarios al inicio
        const { startQuoteFollowUpJob } = require('./jobs/quote-followup.job');
        const { startInvoiceReminderJob } = require('./jobs/invoice-reminder.job');
        startQuoteFollowUpJob();
        startInvoiceReminderJob();
    }
    catch (err) {
        console.error('❌ Cron init error:', err);
    }
});
module.exports = app_1.default;
