"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startQuoteFollowUpJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const quote_followup_service_1 = require("../services/quote-followup.service");
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
const startQuoteFollowUpJob = () => {
    console.log('🔧 Configurando job de seguimiento de Quotes...');
    // Ejecutar todos los días a las 09:00 AM
    node_cron_1.default.schedule('0 9 * * *', () => __awaiter(void 0, void 0, void 0, function* () {
        console.log(`\n⏰ [${new Date().toISOString()}] Ejecutando job programado de seguimiento de Quotes`);
        try {
            const service = new quote_followup_service_1.QuoteFollowUpService();
            yield service.processQuoteFollowUps();
        }
        catch (error) {
            console.error('❌ Error en el job de seguimiento de Quotes:', error.message);
            console.error(error.stack);
        }
    }), {
        timezone: 'America/Santo_Domingo' // Ajusta según tu zona horaria
    });
    console.log('✅ Job de seguimiento de Quotes configurado (se ejecutará diariamente a las 09:00 AM)');
};
exports.startQuoteFollowUpJob = startQuoteFollowUpJob;
