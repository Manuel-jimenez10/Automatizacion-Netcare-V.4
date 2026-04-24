import { Request, Response } from 'express';
import { WhatsappInitService } from '../services/whatsapp-init.service';

export class WhatsappInitController {

  /**
   * Endpoint para iniciar conversación de WhatsApp desde EspoCRM.
   * POST /api/whatsapp-init/send
   * 
   * El workflow de EspoCRM debe enviar un POST con el contactId.
   */
  static async handleInit(req: Request, res: Response) {
    try {
      console.log('📨 Evento recibido: Enviar mensaje inicial de WhatsApp');
      console.log('   Body:', req.body);

      // EspoCRM envía los campos en snake_case
      const contactId = req.body.contactId || req.body.contact_id || req.body.id;
      const messageEntityId = req.body.entityId || req.body.entity_id;
      const conversationId = req.body.whatsappConverstionId || req.body.whatsapp_converstion_id;

      if (!contactId) {
        console.error('❌ Error: contactId / contact_id no proporcionado en el body');
        res.status(400).json({
          success: false,
          message: 'contactId o contact_id es requerido en el body',
        });
        return;
      }

      const service = new WhatsappInitService();
      const result = await service.handleInitConversation(contactId, messageEntityId, conversationId);

      res.status(200).json({
        success: true,
        message: 'Mensaje inicial enviado exitosamente',
        data: result,
        timestamp: new Date().toISOString(),
      });

    } catch (error: any) {
      console.error('❌ Error en handleInit:', error.message);

      res.status(500).json({
        success: false,
        message: 'Error al enviar iniciar conversación',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
