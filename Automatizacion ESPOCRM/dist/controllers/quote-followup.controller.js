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
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteFollowUpController = void 0;
const quote_followup_service_1 = require("../services/quote-followup.service");
class QuoteFollowUpController {
    /**
     * Endpoint para ejecutar manualmente el proceso de seguimiento de Quotes
     * Útil para testing y debugging
     * POST /api/quotes/run-followup
     */
    static runFollowUp(req, res) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log('🔧 Ejecución manual del proceso de seguimiento de Quotes solicitada');
                const service = new quote_followup_service_1.QuoteFollowUpService();
                yield service.processQuoteFollowUps();
                res.status(200).json({
                    success: true,
                    message: 'Proceso de seguimiento de Quotes ejecutado exitosamente',
                    timestamp: new Date().toISOString(),
                });
            }
            catch (error) {
                console.error('❌ Error en ejecución manual:', error.message);
                res.status(500).json({
                    success: false,
                    message: 'Error al ejecutar el proceso de seguimiento de Quotes',
                    error: error.message,
                    timestamp: new Date().toISOString(),
                });
            }
        });
    }
}
exports.QuoteFollowUpController = QuoteFollowUpController;
