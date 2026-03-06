"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceConfirmedController = void 0;
const invoice_confirmed_service_1 = require("../services/invoice-confirmed.service");
class InvoiceConfirmedController {
    /**
     * Endpoint para manejar el evento de Prefactura Confirmada
     * POST /api/invoices/confirmed
     * Body: { "invoiceId": "..." } o { "id": "..." }
     */
    static async handleConfirmed(req, res) {
        try {
            console.log('📨 Evento recibido: Prefactura confirmada');
            console.log('   Body:', req.body);
            // EspoCRM envía { id: '...' }, pero aceptamos ambos por compatibilidad
            const invoiceId = req.body.invoiceId || req.body.id;
            if (!invoiceId) {
                console.error('❌ Error: invoiceId/id no proporcionado en el body');
                res.status(400).json({
                    success: false,
                    message: 'invoiceId o id es requerido en el body',
                });
                return;
            }
            const service = new invoice_confirmed_service_1.InvoiceConfirmedService();
            await service.handleInvoiceConfirmed(invoiceId);
            res.status(200).json({
                success: true,
                message: 'Proceso de Prefactura Confirmada completado exitosamente',
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            console.error('❌ Error en handleConfirmed:', error.message);
            res.status(500).json({
                success: false,
                message: 'Error al procesar el evento de Prefactura Confirmada',
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    }
}
exports.InvoiceConfirmedController = InvoiceConfirmedController;
