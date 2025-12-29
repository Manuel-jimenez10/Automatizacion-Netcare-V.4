import { Request, Response } from 'express';
import { QuoteFollowUpService } from '../services/quote-followup.service';

export class QuoteFollowUpController {
  /**
   * Endpoint para ejecutar manualmente el proceso de seguimiento de Quotes
   * Útil para testing y debugging
   * POST /api/quotes/run-followup
   */
  static async runFollowUp(req: Request, res: Response) {
    try {
      console.log('🔧 Ejecución manual del proceso de seguimiento de Quotes solicitada');

      const service = new QuoteFollowUpService();
      await service.processQuoteFollowUps();

      res.status(200).json({
        success: true,
        message: 'Proceso de seguimiento de Quotes ejecutado exitosamente',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
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
