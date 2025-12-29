"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendQuoteFollowUpMessage = exports.sendTaskCompletedMessage = void 0;
const twilio_1 = __importDefault(require("twilio"));
const env_1 = require("../config/env");
const client = (0, twilio_1.default)(env_1.env.twilioAccountSid, env_1.env.twilioAuthToken);
const sendTaskCompletedMessage = (_a) => __awaiter(void 0, [_a], void 0, function* ({ phone, clientName, taskName, }) {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    // Validar formato de teléfono (debe incluir código de país)
    const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    console.log(`📱 Enviando WhatsApp a: ${formattedPhone}`);
    try {
        const message = yield client.messages.create({
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.twilioTemplateSid,
            contentVariables: JSON.stringify({
                1: clientName || 'Cliente',
                2: taskName,
            }),
        });
        console.log(`✅ Mensaje de WhatsApp enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        console.log(`   - Estado: ${message.status}`);
        console.log(`   - Template: ${env_1.env.twilioTemplateSid}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando WhatsApp:', error.message);
        if (error.code) {
            console.error(`   - Código de error Twilio: ${error.code}`);
        }
        throw error;
    }
});
exports.sendTaskCompletedMessage = sendTaskCompletedMessage;
const sendQuoteFollowUpMessage = (_a) => __awaiter(void 0, [_a], void 0, function* ({ phone, clientName, quoteName, }) {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    // Validar formato de teléfono (debe incluir código de país)
    const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    console.log(`📱 Enviando WhatsApp de seguimiento de Quote a: ${formattedPhone}`);
    try {
        const message = yield client.messages.create({
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.twilioQuoteTemplateSid,
            contentVariables: JSON.stringify({
                1: clientName || 'Cliente',
                2: quoteName,
            }),
        });
        console.log(`✅ Mensaje de seguimiento de Quote enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        console.log(`   - Estado: ${message.status}`);
        console.log(`   - Template: ${env_1.env.twilioQuoteTemplateSid}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando WhatsApp de seguimiento:', error.message);
        if (error.code) {
            console.error(`   - Código de error Twilio: ${error.code}`);
        }
        throw error;
    }
});
exports.sendQuoteFollowUpMessage = sendQuoteFollowUpMessage;
