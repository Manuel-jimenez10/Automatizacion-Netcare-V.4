"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappInitController = void 0;
const whatsapp_init_service_1 = require("../services/whatsapp-init.service");
class WhatsappInitController {
    /**
     * Endpoint para iniciar conversación de WhatsApp desde EspoCRM.
     * POST /api/whatsapp-init/send
     *
     * El workflow de EspoCRM debe enviar un POST con el contactId.
     */
    static async handleInit(req, res) {
        try {
            console.log('📨 Evento recibido: Enviar mensaje inicial de WhatsApp');
            console.log('   Body:', req.body);
            // EspoCRM enviará el payload del registro WhatsappMessage
            // Buscamos el contactId
            const contactId = req.body.contactId;
            if (!contactId) {
                console.error('❌ Error: contactId no proporcionado en el body');
                res.status(400).json({
                    success: false,
                    message: 'contactId es requerido en el body',
                });
                return;
            }
            const service = new whatsapp_init_service_1.WhatsappInitService();
            const result = await service.handleInitConversation(contactId);
            res.status(200).json({
                success: true,
                message: 'Mensaje inicial enviado exitosamente',
                data: result,
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
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
exports.WhatsappInitController = WhatsappInitController;
