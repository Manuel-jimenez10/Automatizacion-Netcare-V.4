import { Request, Response } from 'express';
import { InvoiceConfirmedService } from '../services/invoice-confirmed.service';

export class InvoiceConfirmedController {
  
  /**
   * Endpoint para manejar el evento de Prefactura Confirmada
   * POST /api/invoices/confirmed
   * Body: { "invoiceId": "..." } o { "id": "..." }
   */
  static async handleConfirmed(req: Request, res: Response) {
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

      const service = new InvoiceConfirmedService();
      await service.handleInvoiceConfirmed(invoiceId);

      res.status(200).json({
        success: true,
        message: 'Proceso de Prefactura Confirmada completado exitosamente',
        timestamp: new Date().toISOString(),
      });

    } catch (error: any) {
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
