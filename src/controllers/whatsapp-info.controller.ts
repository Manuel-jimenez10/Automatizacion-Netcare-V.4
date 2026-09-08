import { Request, Response } from 'express';
import { WhatsappInfoService } from '../services/whatsapp-info.service';
import { env } from '../config/env';

const secretIsValid = (req: Request): boolean => {
  if (!env.whatsappInfoRequireSecret) return true;

  const provided =
    (req.headers['x-webhook-secret'] as string) || (req.body && req.body.secret) || '';

  return !!provided && provided === env.internalWebhookSecret;
};

export class WhatsappInfoController {
  /**
   * Envío del mensaje informativo al cliente.
   * POST /api/whatsapp/send-info
   *
   * Lo dispara un workflow de EspoCRM cuando el agente marca la casilla en un
   * WhatsappMessage. Acepta el payload completo de la entidad o solo { id }.
   *
   * Responde de forma síncrona a propósito: los workflows de EspoCRM esperan
   * la respuesta y el agente necesita saber en el acto si el mensaje salió.
   */
  static async handleSendInfo(req: Request, res: Response) {
    try {
      if (!secretIsValid(req)) {
        res.status(401).json({
          success: false,
          message:
            'Secreto inválido o ausente. El workflow debe enviar la cabecera x-webhook-secret ' +
            'con el valor de INTERNAL_WEBHOOK_SECRET.',
        });
        return;
      }

      const service = new WhatsappInfoService();
      const result = await service.handleSendInfo(req.body || {});

      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('❌ [Info Cliente] Error enviando el mensaje informativo:', error.message);

      res.status(500).json({
        success: false,
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
