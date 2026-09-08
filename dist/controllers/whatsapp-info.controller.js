"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappInfoController = void 0;
const whatsapp_info_service_1 = require("../services/whatsapp-info.service");
const env_1 = require("../config/env");
const secretIsValid = (req) => {
    if (!env_1.env.whatsappInfoRequireSecret)
        return true;
    const provided = req.headers['x-webhook-secret'] || (req.body && req.body.secret) || '';
    return !!provided && provided === env_1.env.internalWebhookSecret;
};
class WhatsappInfoController {
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
    static async handleSendInfo(req, res) {
        try {
            if (!secretIsValid(req)) {
                res.status(401).json({
                    success: false,
                    message: 'Secreto inválido o ausente. El workflow debe enviar la cabecera x-webhook-secret ' +
                        'con el valor de INTERNAL_WEBHOOK_SECRET.',
                });
                return;
            }
            const service = new whatsapp_info_service_1.WhatsappInfoService();
            const result = await service.handleSendInfo(req.body || {});
            res.status(200).json({
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            console.error('❌ [Info Cliente] Error enviando el mensaje informativo:', error.message);
            res.status(500).json({
                success: false,
                message: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    }
}
exports.WhatsappInfoController = WhatsappInfoController;
