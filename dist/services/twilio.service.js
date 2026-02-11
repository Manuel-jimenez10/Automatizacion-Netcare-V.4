"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNotificationTemplate = exports.sendMediaMessage = exports.sendTextMessage = exports.sendQuoteFollowUpMessage = exports.sendTaskCompletedMessage = void 0;
const twilio_1 = __importDefault(require("twilio"));
const env_1 = require("../config/env");
const client = (0, twilio_1.default)(env_1.env.twilioAccountSid, env_1.env.twilioAuthToken);
const sendTaskCompletedMessage = async ({ phone, clientName, taskName, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    // Validar formato de teléfono (debe incluir código de país)
    // Remove spaces and non-digit characters except leading '+'
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando WhatsApp a: ${formattedPhone}`);
    try {
        const message = await client.messages.create({
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
};
exports.sendTaskCompletedMessage = sendTaskCompletedMessage;
const sendQuoteFollowUpMessage = async ({ phone, clientName, quoteName, pdfUrl, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    // Validar formato de teléfono (debe incluir código de país)
    // Remove spaces and non-digit characters except leading '+'
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando WhatsApp de seguimiento de Quote a: ${formattedPhone}`);
    try {
        const variables = {
            1: pdfUrl || '', // Variable {{1}} es MEDIA (PDF)
            2: clientName || 'Cliente', // Variable {{2}} es NOMBRE
            3: quoteName, // Variable {{3}} es COTIZACION
        };
        console.log(`📦 Variables enviadas a Twilio:`, JSON.stringify(variables));
        // ========================================
        // VALIDACIÓN Y LIMPIEZA DE STATUS CALLBACK URL
        // ========================================
        let validatedCallbackUrl = undefined;
        if (env_1.env.twilioStatusCallbackUrl) {
            const rawUrl = env_1.env.twilioStatusCallbackUrl.trim(); // Eliminar espacios
            // Validaciones
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl); // Detectar URLs duplicadas
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl); // Guión bajo en hostname
            console.log('\n🔍 [VALIDACIÓN] StatusCallback URL:');
            console.log('  - URL cruda:', rawUrl);
            console.log('  - Longitud:', rawUrl.length);
            console.log('  - ✅ Tiene protocolo:', hasProtocol);
            console.log('  - ❌ URL duplicada:', hasDoubleUrl);
            console.log('  - ❌ Tiene espacios:', hasSpace);
            console.log('  - ❌ Guión bajo en hostname:', hasUnderscore);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
                validatedCallbackUrl = rawUrl;
                console.log('  ✅ URL VÁLIDA - Se enviará a Twilio');
            }
            else {
                console.warn('  ⚠️ URL INVÁLIDA - NO se enviará statusCallback');
                if (!hasProtocol)
                    console.warn('     → Falta protocolo https://');
                if (hasDoubleUrl)
                    console.warn('     → URL duplicada detectada');
                if (hasSpace)
                    console.warn('     → Contiene espacios');
                if (hasUnderscore)
                    console.warn('     → Hostname con guión bajo (_)');
            }
        }
        else {
            console.log('\n⚠️ [VALIDACIÓN] twilioStatusCallbackUrl no está definida en .env');
        }
        console.log('========================================\n');
        // Build message params WITH statusCallback (override Twilio Console settings)
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.twilioQuoteTemplateSid,
            contentVariables: JSON.stringify(variables),
        };
        // Solo agregar statusCallback si la URL es válida
        if (validatedCallbackUrl) {
            messageParams.statusCallback = validatedCallbackUrl;
            console.log('📡 Enviando CON statusCallback:', validatedCallbackUrl);
        }
        else {
            console.log('📡 Enviando SIN statusCallback (puede causar error 21609 si hay config errónea en Twilio)');
        }
        const message = await client.messages.create(messageParams);
        // Log completo para debugging
        console.log(`✅ Mensaje de seguimiento de Quote enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        console.log(`   - Estado: ${message.status}`);
        console.log(`   - Template: ${env_1.env.twilioQuoteTemplateSid}`);
        console.log(`   - ErrorCode: ${message.errorCode || 'ninguno'}`);
        console.log(`   - ErrorMessage: ${message.errorMessage || 'ninguno'}`);
        console.log(`   - From: ${message.from}`);
        console.log(`   - To: ${message.to}`);
        console.log(`   📊 Respuesta completa de Twilio:`, JSON.stringify(message, null, 2));
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando WhatsApp de seguimiento:', error.message);
        if (error.code) {
            console.error(`   - Código de error Twilio: ${error.code}`);
        }
        throw error;
    }
};
exports.sendQuoteFollowUpMessage = sendQuoteFollowUpMessage;
const sendTextMessage = async ({ phone, text, statusCallback, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!text)
        throw new Error('El mensaje de texto es requerido');
    // Validar formato de teléfono
    // Remove spaces and non-digit characters except leading '+'
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando SMS/WhatsApp (Texto Libre) a: ${formattedPhone}`);
    console.log(`🔍 [DEBUG] statusCallback recibido:`, statusCallback);
    console.log(`🔍 [DEBUG] statusCallback type:`, typeof statusCallback);
    console.log(`🔍 [DEBUG] statusCallback === undefined:`, statusCallback === undefined);
    // console.log(`   - Texto: ${text}`); 
    try {
        // Build message params - only include statusCallback if provided
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            body: text,
        };
        // Only add statusCallback if it's a valid URL
        if (statusCallback) {
            console.log(`✅ [DEBUG] Agregando statusCallback: ${statusCallback}`);
            messageParams.statusCallback = statusCallback;
        }
        else {
            console.log(`⚠️ [DEBUG] NO se agregó statusCallback (valor: ${statusCallback})`);
        }
        console.log(`📦 [DEBUG] messageParams final:`, JSON.stringify(messageParams, null, 2));
        const message = await client.messages.create(messageParams);
        console.log(`✅ Mensaje de texto enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando mensaje de texto:', error.message);
        if (error.code) {
            console.error(`   - Código de error Twilio: ${error.code}`);
        }
        throw error;
    }
};
exports.sendTextMessage = sendTextMessage;
const sendMediaMessage = async ({ phone, mediaUrls, body, statusCallback, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!mediaUrls || mediaUrls.length === 0) {
        throw new Error('Se requiere al menos una URL de media');
    }
    // Limpiar teléfono
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando Media WhatsApp a: ${formattedPhone}`);
    console.log(`   - Media URLs: ${mediaUrls.join(', ')}`);
    if (body)
        console.log(`   - Caption: ${body}`);
    try {
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            mediaUrl: mediaUrls, // Twilio acepta array de URLs
        };
        if (body) {
            messageParams.body = body;
        }
        if (statusCallback) {
            messageParams.statusCallback = statusCallback;
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Mensaje con media enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        console.log(`   - Estado: ${message.status}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando media por WhatsApp:', error.message);
        if (error.code) {
            console.error(`   - Código de error Twilio: ${error.code}`);
        }
        throw error;
    }
};
exports.sendMediaMessage = sendMediaMessage;
const sendNotificationTemplate = async ({ phone, adminName, messageContent, statusCallback, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!env_1.env.notificationTemplateSid)
        throw new Error('NOTIFICATION_TEMPLATE_SID no configurado');
    // Limpiar teléfono
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando Template de Notificación a: ${formattedPhone}`);
    try {
        const variables = {
            1: adminName || 'Admin',
            2: messageContent
        };
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.notificationTemplateSid,
            contentVariables: JSON.stringify(variables),
        };
        if (statusCallback) {
            messageParams.statusCallback = statusCallback;
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Notificación por Template enviada exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando notificación por Template:', error.message);
        throw error;
    }
};
exports.sendNotificationTemplate = sendNotificationTemplate;
