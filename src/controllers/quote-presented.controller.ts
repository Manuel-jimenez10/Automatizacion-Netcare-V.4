import { Request, Response } from 'express';
import { QuotePresentedService } from '../services/quote-presented.service';

export class QuotePresentedController {
  
  /**
   * Endpoint para manejar el evento de Quote Presentada
   * POST /api/quotes/presented
   * Body: { "quoteId": "..." }
   */
  static async handlePresented(req: Request, res: Response) {
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

      const service = new QuotePresentedService();
      await service.handleQuotePresented(quoteId);

      res.status(200).json({
        success: true,
        message: 'Proceso de Quote Presentada completado exitosamente',
        timestamp: new Date().toISOString(),
      });

    } catch (error: any) {
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
