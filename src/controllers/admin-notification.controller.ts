import { Request, Response } from 'express';
import { adminNotificationService } from '../services/admin-notification.service';
import { EspoCRMClient } from '../services/espocrm-api-client.service';
import { maskPhone, sanitizeTemplateVariable } from '../utils/notification-phone.utils';
import { env } from '../config/env';

const espoClient = new EspoCRMClient();

/**
 * Verifica el secreto compartido. Activo por defecto: sin él, estos endpoints
 * serían un emisor de WhatsApp abierto a internet (y la vía más rápida para
 * que Meta vuelva a bloquear el sender).
 *
 * Se acepta en el header `x-webhook-secret` o en el body `{ "secret": "..." }`
 * para que funcione desde un workflow de EspoCRM.
 */
const secretIsValid = (req: Request): boolean => {
  if (!env.adminNotificationRequireSecret) return true;

  const provided =
    (req.headers['x-webhook-secret'] as string) ||
    (req.body && req.body.secret) ||
    '';

  return !!provided && provided === env.internalWebhookSecret;
};

const rejectUnauthorized = (res: Response) => {
  res.status(401).json({ success: false, message: 'Secreto inválido o ausente' });
};

export class AdminNotificationController {

  /**
   * Disparador desde EspoCRM: se llama cuando se CREA un WhatsappMessage.
   * POST /api/admin-notifications/whatsapp-message
   *
   * Acepta el payload completo de la entidad (lo que envía un workflow de
   * EspoCRM) o simplemente { id }. Solo notifica mensajes entrantes
   * (type = "In"). La deduplicación por messageSid evita el doble aviso
   * cuando el mismo mensaje ya se notificó desde el webhook de Twilio.
   *
   * Responde de inmediato y notifica en segundo plano: los workflows de
   * EspoCRM son síncronos y no deben quedarse esperando a Twilio.
   */
  static async handleCrmMessage(req: Request, res: Response) {
    try {
      if (!secretIsValid(req)) {
        rejectUnauthorized(res);
        return;
      }

      const payload = req.body || {};
      const entityId = payload.id || payload.messageId || payload.whatsappMessageId;

      let entity: any = payload;

      // El workflow puede mandar solo el ID, o un payload parcial. Se relee la
      // entidad también cuando falta el messageSid: sin él la deduplicación
      // caería al ID de EspoCRM y no cruzaría con la del webhook de Twilio,
      // así que el administrador recibiría el aviso por duplicado.
      const missingContent =
        !entity.type ||
        !entity.messageSid ||
        (!entity.description && !entity.text && !entity.body);
      if (entityId && missingContent) {
        try {
          entity = await espoClient.getEntity('WhatsappMessage', entityId);
        } catch (fetchError: any) {
          console.warn(
            `⚠️ [Notif Admin] No se pudo leer WhatsappMessage ${entityId}: ${fetchError.message}`,
          );
        }
      }

      const type = entity.type || payload.type;
      if (type !== 'In') {
        // Sin `type` no podemos afirmar que sea un mensaje de cliente: no se
        // notifica, para que este endpoint no sirva como emisor genérico.
        res.status(200).json({
          success: true,
          status: 'ignored',
          reason: type ? 'not_incoming' : 'missing_type',
        });
        return;
      }

      const fromPhone = entity.name || entity.contact || payload.from || '';
      const body = entity.description || entity.text || entity.body || '';

      if (!fromPhone) {
        res.status(400).json({ success: false, message: 'Falta el teléfono del remitente' });
        return;
      }

      res.status(202).json({ success: true, status: 'queued', timestamp: new Date().toISOString() });

      adminNotificationService
        .notifyNewClientMessage({
          fromPhone,
          body,
          dedupeKey: entity.messageSid || entityId,
          source: 'espocrm-workflow',
        })
        .catch((err: any) =>
          console.error('⚠️ [Notif Admin] Error no controlado (workflow CRM):', err.message),
        );
    } catch (error: any) {
      console.error('❌ [Notif Admin] Error en handleCrmMessage:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: error.message });
      }
    }
  }

  /**
   * Estado de la ventana de 24h de cada administrador.
   * GET /api/admin-notifications/status   (header x-webhook-secret)
   *
   * El secreto va SOLO en el header: la app loguea `req.url` de cada petición,
   * así que en la query string acabaría escrito en claro en los logs.
   *
   * Los teléfonos van enmascarados salvo que se pida `?reveal=true`.
   */
  static getStatus(req: Request, res: Response) {
    const provided = (req.headers['x-webhook-secret'] as string) || '';

    if (env.adminNotificationRequireSecret && provided !== env.internalWebhookSecret) {
      rejectUnauthorized(res);
      return;
    }

    res.status(200).json({
      success: true,
      data: adminNotificationService.getStatus({ revealPhones: req.query.reveal === 'true' }),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Envío de prueba. POST /api/admin-notifications/test
   * Body opcional: { from, body }
   */
  static async handleTest(req: Request, res: Response) {
    try {
      if (!secretIsValid(req)) {
        rejectUnauthorized(res);
        return;
      }

      const result = await adminNotificationService.notifyNewClientMessage({
        fromPhone: req.body?.from || '+5215555555555',
        body: req.body?.body || 'Mensaje de prueba del sistema de notificaciones.',
        source: 'test-endpoint',
      });

      // Los teléfonos de los administradores no se devuelven en claro.
      const data = {
        ...result,
        deliveries: result.deliveries.map(d => ({ ...d, phone: maskPhone(d.phone) })),
      };

      res.status(200).json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error: any) {
      console.error('❌ [Notif Admin] Error en handleTest:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Cierra manualmente las ventanas para volver a probar el template.
   * POST /api/admin-notifications/reset  Body opcional: { phone }
   */
  static handleReset(req: Request, res: Response) {
    if (!secretIsValid(req)) {
      rejectUnauthorized(res);
      return;
    }

    adminNotificationService.resetWindows(req.body?.phone);

    res.status(200).json({
      success: true,
      message: req.body?.phone
        ? `Ventana reiniciada para ${req.body.phone}`
        : 'Ventanas reiniciadas para todos los administradores',
      data: adminNotificationService.getStatus(),
    });
  }

  /**
   * StatusCallback dedicado de las notificaciones internas.
   * POST /api/admin-notifications/status-callback
   *
   * Estos mensajes no existen en EspoCRM, así que aquí solo se loguea el
   * resultado. Es lo que evita que el handler general gaste consultas al CRM
   * buscando SIDs que nunca va a encontrar.
   */
  static handleStatusCallback(req: Request, res: Response) {
    const body = req.body || {};

    // El endpoint es público (lo llama Twilio, que no puede enviar el secreto),
    // así que todo lo que se loguea se sanea antes: sin saltos de línea no se
    // pueden falsificar entradas de log.
    const clean = (value: any, max = 120) =>
      value === undefined || value === null ? '' : sanitizeTemplateVariable(String(value), max);

    const sid = clean(body.MessageSid, 40);
    const status = clean(body.MessageStatus, 20);
    const errorCode = clean(body.ErrorCode, 10);
    const errorMessage = clean(body.ErrorMessage, 200);
    const known = adminNotificationService.isNotificationSid(body.MessageSid);

    if (errorCode) {
      console.error(
        `🚨 [Notif Admin] ${sid} → ${status} | ErrorCode ${errorCode}${errorMessage ? ` - ${errorMessage}` : ''}${known ? '' : ' (SID no emitido por este proceso)'}`,
      );
      if (/^\d+$/.test(errorCode)) {
        console.error(`   Detalle: https://www.twilio.com/docs/api/errors/${errorCode}`);
      }
      // Los rechazos por límite o bloqueo de Meta llegan por aquí, no en la
      // respuesta de messages.create: es donde el backoff se vuelve efectivo.
      adminNotificationService.handleDeliveryFailure(body.MessageSid, body.ErrorCode);
    } else {
      console.log(`📬 [Notif Admin] ${sid} → ${status}${known ? '' : ' (SID desconocido)'}`);
    }

    res.status(200).send('OK');
  }
}
