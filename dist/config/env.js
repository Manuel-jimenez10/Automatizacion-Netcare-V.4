"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    espocrmBaseUrl: process.env.ESPOCRM_BASE_URL || '',
    espocrmApiKey: process.env.ESPOCRM_API_KEY || '',
    port: process.env.PORT || 3000,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM || '',
    twilioTemplateSid: process.env.TWILIO_TEMPLATE_SID || '',
    twilioQuoteTemplateSid: process.env.TWILIO_QUOTE_TEMPLATE_SID || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    testPhoneNumber: process.env.TEST_PHONE_NUMBER || '', // Número seguro para pruebas
    publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000', // URL pública para Twilio
    // Nombres de campos en EspoCRM (CONFIRMADOS)
    fieldCotizacionPropuesta: 'cotizacinPropuesta', // Archivo PDF de la cotización
    fieldCotizacionEnviadaWhatsapp: 'cotizacinEnviadaPorWhatsapp', // Fecha de envío por WhatsApp
    twilioStatusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL,
    storageUploadUrl: 'https://nc.salesontop.com/upload.php', // URL corregida
    storageToken: process.env.STORAGE_TOKEN || '', // Token opcional para seguridad
};
