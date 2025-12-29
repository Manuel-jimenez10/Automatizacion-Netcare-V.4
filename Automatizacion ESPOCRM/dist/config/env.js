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
};
