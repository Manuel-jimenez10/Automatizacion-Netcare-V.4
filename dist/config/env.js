"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    espocrmBaseUrl: (process.env.ESPOCRM_BASE_URL || '').trim(),
    espocrmApiKey: (process.env.ESPOCRM_API_KEY || '').trim(),
    port: process.env.PORT || 3000,
    twilioAccountSid: (process.env.TWILIO_ACCOUNT_SID || '').trim(),
    twilioAuthToken: (process.env.TWILIO_AUTH_TOKEN || '').trim(),
    twilioWhatsappFrom: (process.env.TWILIO_WHATSAPP_FROM || '').trim(),
    twilioQuoteTemplateSid: (process.env.TWILIO_QUOTE_TEMPLATE_SID || '').trim(),
    publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').trim(),
    twilioStatusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL ? process.env.TWILIO_STATUS_CALLBACK_URL.trim() : undefined,
    storageUploadUrl: 'https://nc.salesontop.com/upload.php',
    storageToken: (process.env.STORAGE_TOKEN || '').trim(),
    maxMediaSize: 16 * 1024 * 1024, // 16MB - límite de Twilio
    quotePresentedTemplateSid: (process.env.QUOTE_PRESENTED_SID || '').trim(),
    prefacturaConfirmedTemplateSid: (process.env.PREFACTURA_PRESENTED || '').trim(),
};
