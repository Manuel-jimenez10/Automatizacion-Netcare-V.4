import { Request, Response } from 'express';
import { InvoiceReminderService } from '../services/invoice-reminder.service';

export class InvoiceReminderController {
  /**
   * Endpoint para ejecutar manualmente el proceso de recordatorios de Prefacturas
   * Útil para testing y debugging
   * POST o GET /api/prefacturas/run-reminders
   */
  static async runReminders(req: Request, res: Response) {
    try {
      console.log('🔧 Ejecución manual del proceso de recordatorios de Invoices solicitada');

      const service = new InvoiceReminderService();
      await service.processReminders(); // Producción: envía a todos

      res.status(200).json({
        success: true,
        message: 'Proceso de recordatorio de prefacturas ejecutado exitosamente',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('❌ Error en ejecución manual de recordatorios:', error.message);
      
      res.status(500).json({
        success: false,
        message: 'Error al ejecutar el proceso de recordatorios',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
