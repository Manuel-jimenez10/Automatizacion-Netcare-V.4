"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteFollowUpController = void 0;
const quote_followup_service_1 = require("../services/quote-followup.service");
class QuoteFollowUpController {
    /**
     * Endpoint para ejecutar manualmente el proceso de seguimiento de Quotes
     * Útil para testing y debugging
     * POST /api/quotes/run-followup
     */
    static async runFollowUp(req, res) {
        try {
            console.log('🔧 Ejecución manual del proceso de seguimiento de Quotes solicitada');
            const service = new quote_followup_service_1.QuoteFollowUpService();
            await service.processQuoteFollowUps();
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
    }
}
exports.QuoteFollowUpController = QuoteFollowUpController;
