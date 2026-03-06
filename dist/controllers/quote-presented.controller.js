"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuotePresentedController = void 0;
const quote_presented_service_1 = require("../services/quote-presented.service");
class QuotePresentedController {
    /**
     * Endpoint para manejar el evento de Quote Presentada
     * POST /api/quotes/presented
     * Body: { "quoteId": "..." }
     */
    static async handlePresented(req, res) {
        try {
            console.log('📨 Evento recibido: Quote presentada');
            console.log('   Body:', req.body);
            // EspoCRM envía { id: '...' }, pero aceptamos ambos por compatibilidad
            const quoteId = req.body.quoteId || req.body.id;
            if (!quoteId) {
                console.error('❌ Error: quoteId/id no proporcionado en el body');
                res.status(400).json({
                    success: false,
                    message: 'quoteId o id es requerido en el body',
                });
                return;
            }
            const service = new quote_presented_service_1.QuotePresentedService();
            await service.handleQuotePresented(quoteId);
            res.status(200).json({
                success: true,
                message: 'Proceso de Quote Presentada completado exitosamente',
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            console.error('❌ Error en handlePresented:', error.message);
            res.status(500).json({
                success: false,
                message: 'Error al procesar el evento de Quote Presentada',
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    }
}
exports.QuotePresentedController = QuotePresentedController;
