"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startQuoteFollowUpJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const quote_followup_service_1 = require("../services/quote-followup.service");
const quote_followup_controller_1 = require("../controllers/quote-followup.controller");
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
const startQuoteFollowUpJob = () => {
    // Patrón Singleton para evitar múltiples inits si Passenger hace spawn
    if (started) {
        console.log('⚠️ Job de seguimiento ya iniciado. Ignorando llamada.');
        return;
    }
    started = true;
    console.log('🔧 Configurando job de seguimiento de Quotes...');
    // Ejecutar todos los días a las 09:00 AM
    node_cron_1.default.schedule('0 9 * * *', async () => {
        const startedAt = new Date().toISOString();
        console.log(`\n⏰ [${startedAt}] Ejecutando job programado de seguimiento de Quotes`);
        // Mismo candado que el endpoint manual: si alguien lo lanzó a mano a las
        // 09:00, las dos ejecuciones leerían el mismo contador y duplicarían envíos.
        if (!quote_followup_controller_1.QuoteFollowUpController.tryAcquire()) {
            console.log('⚠️ Ya hay un proceso de seguimiento en curso. Se omite esta ejecución.');
            return;
        }
        try {
            const service = new quote_followup_service_1.QuoteFollowUpService();
            const result = await service.processQuoteFollowUps();
            quote_followup_controller_1.QuoteFollowUpController.recordCronRun(result, startedAt);
        }
        catch (error) {
            console.error('❌ Error en el job de seguimiento de Quotes:', error.message);
            console.error(error.stack);
            quote_followup_controller_1.QuoteFollowUpController.recordCronError(error.message);
        }
        finally {
            quote_followup_controller_1.QuoteFollowUpController.release();
        }
    }, {
        timezone: 'America/Mexico_City' // Ajusta según tu zona horaria
    });
    console.log('✅ Job de seguimiento de Quotes configurado (se ejecutará diariamente a las 09:00 AM)');
};
exports.startQuoteFollowUpJob = startQuoteFollowUpJob;
