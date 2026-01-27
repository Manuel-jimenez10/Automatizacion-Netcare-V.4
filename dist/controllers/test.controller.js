"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.testTemplateMessage = exports.testWhatsApp = void 0;
const twilio_service_1 = require("../services/twilio.service");
const env_1 = require("../config/env");
const testWhatsApp = async (_req, res) => {
    try {
        const testPhone = env_1.env.testPhoneNumber || '+584121292194';
        console.log('🧪 [TEST] Llamando sendTextMessage...');
        console.log('🧪 [TEST] Phone:', testPhone);
        console.log('🧪 [TEST] StatusCallback será:', undefined);
        await (0, twilio_service_1.sendTextMessage)({
            phone: testPhone,
            text: '🧪 Este es un mensaje de PRUEBA sin template. Si lo ves, significa que Twilio funciona correctamente.',
        });
        res.json({
            success: true,
            message: `Mensaje de prueba enviado a ${testPhone}. Revisa tu WhatsApp.`,
            note: 'Este mensaje NO usa templates, solo texto plano. Si llega, el problema es específico del template de cotizaciones.'
        });
    }
    catch (error) {
        console.error('🧪 [TEST] Error completo:', error);
        res.status(500).json({ error: error.message });
    }
};
exports.testWhatsApp = testWhatsApp;
const testTemplateMessage = async (_req, res) => {
    try {
        const testPhone = env_1.env.testPhoneNumber || '+584121292194';
        const { sendQuoteFollowUpMessage } = await Promise.resolve().then(() => __importStar(require('../services/twilio.service')));
        await sendQuoteFollowUpMessage({
            phone: testPhone,
            clientName: 'Usuario de Prueba',
            quoteName: 'Cotización de Diagnóstico',
            pdfUrl: undefined, // Sin PDF para esta prueba
        });
        res.json({
            success: true,
            message: `Mensaje CON template enviado a ${testPhone}. Revisa tu WhatsApp Y los logs de Twilio.`,
            instructions: `
      IMPORTANTE: Verifica en Twilio Console:
      1. Que el template ${env_1.env.twilioQuoteTemplateSid} esté APROBADO
      2. Que el template esté asociado al sender ${env_1.env.twilioWhatsappFrom}
      3. Busca el SID del mensaje en Messaging > Logs
      `
        });
    }
    catch (error) {
        res.status(500).json({
            error: error.message,
            hint: 'Si el error menciona "template" o "content", verifica que el template esté aprobado en Twilio para tu número de producción.'
        });
    }
};
exports.testTemplateMessage = testTemplateMessage;
