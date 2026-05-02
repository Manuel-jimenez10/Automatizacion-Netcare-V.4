"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDynamicTemplateMessage = exports.sendPrefacturaReminderMessage = exports.sendMediaMessage = exports.sendTextMessage = exports.sendFacturaXmlButtonMessage = exports.sendFacturaAdicionalMessage = exports.sendFacturaPresentedMessage = exports.sendInvoiceConfirmedMessage = exports.sendQuotePresentedMessage = exports.sendQuoteFollowUpMessage = void 0;
const twilio_1 = __importDefault(require("twilio"));
const env_1 = require("../config/env");
const client = (0, twilio_1.default)(env_1.env.twilioAccountSid, env_1.env.twilioAuthToken);
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
const sendQuotePresentedMessage = async ({ phone, clientName, quoteName, pdfUrl, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!env_1.env.quotePresentedTemplateSid)
        throw new Error('QUOTE_PRESENTED_SID no configurado en .env');
    // Validar formato de teléfono
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando WhatsApp de cotización presentada a: ${formattedPhone}`);
    try {
        const variables = {
            1: clientName || 'Cliente', // Variable {{1}} es NOMBRE
            2: quoteName, // Variable {{2}} es COTIZACION
            3: pdfUrl || '', // Variable {{3}} es MEDIA (PDF)
        };
        console.log(`📦 Variables enviadas a Twilio:`, JSON.stringify(variables));
        // Validación de Status Callback URL (misma lógica que sendQuoteFollowUpMessage)
        let validatedCallbackUrl = undefined;
        if (env_1.env.twilioStatusCallbackUrl) {
            const rawUrl = env_1.env.twilioStatusCallbackUrl.trim();
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl);
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
                validatedCallbackUrl = rawUrl;
                console.log('  ✅ StatusCallback URL válida');
            }
            else {
                console.warn('  ⚠️ StatusCallback URL inválida - NO se enviará');
            }
        }
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.quotePresentedTemplateSid,
            contentVariables: JSON.stringify(variables),
        };
        if (validatedCallbackUrl) {
            messageParams.statusCallback = validatedCallbackUrl;
            console.log('📡 Enviando CON statusCallback:', validatedCallbackUrl);
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Mensaje de cotización presentada enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        console.log(`   - Estado: ${message.status}`);
        console.log(`   - Template: ${env_1.env.quotePresentedTemplateSid}`);
        console.log(`   - ErrorCode: ${message.errorCode || 'ninguno'}`);
        console.log(`   - ErrorMessage: ${message.errorMessage || 'ninguno'}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando WhatsApp de cotización presentada:', error.message);
        if (error.code) {
            console.error(`   - Código de error Twilio: ${error.code}`);
        }
        throw error;
    }
};
exports.sendQuotePresentedMessage = sendQuotePresentedMessage;
const sendInvoiceConfirmedMessage = async ({ phone, clientName, invoiceName, pdfUrl, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!env_1.env.prefacturaConfirmedTemplateSid)
        throw new Error('PREFACTURA_PRESENTED no configurado en .env');
    // Validar formato de teléfono
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando WhatsApp de prefactura confirmada a: ${formattedPhone}`);
    try {
        const variables = {
            1: clientName || 'Cliente', // Variable {{1}} es NOMBRE
            2: invoiceName, // Variable {{2}} es PREFACTURA
            3: pdfUrl || '', // Variable {{3}} es MEDIA (PDF)
        };
        console.log(`📦 Variables enviadas a Twilio:`, JSON.stringify(variables));
        // Validación de Status Callback URL
        let validatedCallbackUrl = undefined;
        if (env_1.env.twilioStatusCallbackUrl) {
            const rawUrl = env_1.env.twilioStatusCallbackUrl.trim();
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl);
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
                validatedCallbackUrl = rawUrl;
                console.log('  ✅ StatusCallback URL válida');
            }
            else {
                console.warn('  ⚠️ StatusCallback URL inválida - NO se enviará');
            }
        }
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.prefacturaConfirmedTemplateSid,
            contentVariables: JSON.stringify(variables),
        };
        if (validatedCallbackUrl) {
            messageParams.statusCallback = validatedCallbackUrl;
            console.log('📡 Enviando CON statusCallback:', validatedCallbackUrl);
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Mensaje de prefactura confirmada enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        console.log(`   - Estado: ${message.status}`);
        console.log(`   - Template: ${env_1.env.prefacturaConfirmedTemplateSid}`);
        console.log(`   - ErrorCode: ${message.errorCode || 'ninguno'}`);
        console.log(`   - ErrorMessage: ${message.errorMessage || 'ninguno'}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando WhatsApp de prefactura confirmada:', error.message);
        if (error.code) {
            console.error(`   - Código de error Twilio: ${error.code}`);
        }
        throw error;
    }
};
exports.sendInvoiceConfirmedMessage = sendInvoiceConfirmedMessage;
const sendFacturaPresentedMessage = async ({ phone, clientName, invoiceName, pdfUrl, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!env_1.env.facturaPresentedTemplateSid)
        throw new Error('FACTURA_PRESENTED no configurado en .env');
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando WhatsApp de Factura Sola a: ${formattedPhone}`);
    try {
        const variables = {
            1: clientName || 'Cliente', // Variable {{1}} es NOMBRE
            2: invoiceName, // Variable {{2}} es PREFACTURA/FACTURA nombre
            3: pdfUrl || '', // Variable {{3}} es MEDIA (PDF)
        };
        console.log(`📦 Variables enviadas a Twilio:`, JSON.stringify(variables));
        let validatedCallbackUrl = undefined;
        if (env_1.env.twilioStatusCallbackUrl) {
            const rawUrl = env_1.env.twilioStatusCallbackUrl.trim();
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl);
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
                validatedCallbackUrl = rawUrl;
            }
        }
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.facturaPresentedTemplateSid,
            contentVariables: JSON.stringify(variables),
        };
        if (validatedCallbackUrl) {
            messageParams.statusCallback = validatedCallbackUrl;
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Mensaje de Factura enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando WhatsApp de Factura Sola:', error.message);
        throw error;
    }
};
exports.sendFacturaPresentedMessage = sendFacturaPresentedMessage;
const sendFacturaAdicionalMessage = async ({ phone, pdfUrl, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!env_1.env.facturaAdicionalTemplateSid)
        throw new Error('FACTURA_ADICIONAL no configurado en .env');
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando WhatsApp de Factura Adicional a: ${formattedPhone}`);
    try {
        const variables = {
            1: pdfUrl || '', // Variable {{1}} es MEDIA (PDF)
        };
        console.log(`📦 Variables enviadas a Twilio:`, JSON.stringify(variables));
        let validatedCallbackUrl = undefined;
        if (env_1.env.twilioStatusCallbackUrl) {
            const rawUrl = env_1.env.twilioStatusCallbackUrl.trim();
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl);
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
                validatedCallbackUrl = rawUrl;
            }
        }
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.facturaAdicionalTemplateSid,
            contentVariables: JSON.stringify(variables),
        };
        if (validatedCallbackUrl) {
            messageParams.statusCallback = validatedCallbackUrl;
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Mensaje de Factura Adicional enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando WhatsApp de Factura Adicional:', error.message);
        throw error;
    }
};
exports.sendFacturaAdicionalMessage = sendFacturaAdicionalMessage;
const sendFacturaXmlButtonMessage = async ({ phone, invoiceName, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!env_1.env.facturaPresentedXmlSid)
        throw new Error('FACTURA_PRESENTED_XML no configurado en .env');
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando Quick Reply "Solicitar mi XML" a: ${formattedPhone}`);
    try {
        const variables = {
            1: invoiceName, // Variable {{1}} es el nombre de la factura
        };
        console.log(`📦 Variables enviadas a Twilio (Quick Reply XML):`, JSON.stringify(variables));
        let validatedCallbackUrl = undefined;
        if (env_1.env.twilioStatusCallbackUrl) {
            const rawUrl = env_1.env.twilioStatusCallbackUrl.trim();
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl);
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
                validatedCallbackUrl = rawUrl;
            }
        }
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: env_1.env.facturaPresentedXmlSid,
            contentVariables: JSON.stringify(variables),
        };
        if (validatedCallbackUrl) {
            messageParams.statusCallback = validatedCallbackUrl;
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Quick Reply "Solicitar mi XML" enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando Quick Reply de XML:', error.message);
        throw error;
    }
};
exports.sendFacturaXmlButtonMessage = sendFacturaXmlButtonMessage;
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
const sendPrefacturaReminderMessage = async ({ phone, clientName, invoiceName, fechaLimiteDePago, pdfUrl, templateSid, isOverdue, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!templateSid)
        throw new Error('El template SID es requerido');
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando recordatorio de prefactura a: ${formattedPhone} (Template: ${templateSid})`);
    try {
        // Variables condicionales según el template:
        // ──────────────────────────────────────────────────
        // 3 DÍAS (HX8411...):  {{1}}=nombre, {{2}}=prefactura, {{3}}=fechaLímite, {{4}}=PDF
        // VENCIDO (HX4936...): {{1}}=nombre, {{2}}=fechaLímite, {{3}}=PDF
        // ──────────────────────────────────────────────────
        let variables;
        if (isOverdue) {
            // Template VENCIMIENTO: 3 variables
            variables = {
                1: clientName || 'Cliente', // {{1}} nombre del cliente
                2: fechaLimiteDePago, // {{2}} fecha límite de pago
                3: pdfUrl || '', // {{3}} PDF adjunto
            };
        }
        else {
            // Template 3 DÍAS: 4 variables
            variables = {
                1: clientName || 'Cliente', // {{1}} nombre del cliente
                2: invoiceName, // {{2}} nombre de la prefactura
                3: fechaLimiteDePago, // {{3}} fecha límite de pago
                4: pdfUrl || '', // {{4}} PDF adjunto
            };
        }
        console.log(`📦 Variables enviadas a Twilio (${isOverdue ? 'VENCIDO' : '3 DÍAS'}):`, JSON.stringify(variables));
        let validatedCallbackUrl = undefined;
        if (env_1.env.twilioStatusCallbackUrl) {
            const rawUrl = env_1.env.twilioStatusCallbackUrl.trim();
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl);
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
                validatedCallbackUrl = rawUrl;
            }
        }
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: templateSid,
            contentVariables: JSON.stringify(variables),
        };
        if (validatedCallbackUrl) {
            messageParams.statusCallback = validatedCallbackUrl;
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Mensaje de recordatorio enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando recordatorio de prefactura:', error.message);
        throw error;
    }
};
exports.sendPrefacturaReminderMessage = sendPrefacturaReminderMessage;
const sendDynamicTemplateMessage = async ({ phone, contentSid, contentVariables, }) => {
    if (!phone)
        throw new Error('El número de teléfono es requerido');
    if (!contentSid)
        throw new Error('El contentSid del template es requerido');
    // Validar formato de teléfono
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
    console.log(`📱 Enviando WhatsApp con template dinámico a: ${formattedPhone}`);
    console.log(`   - Template SID: ${contentSid}`);
    console.log(`📦 Variables enviadas a Twilio:`, JSON.stringify(contentVariables));
    try {
        // Validación de Status Callback URL (misma lógica que las demás funciones)
        let validatedCallbackUrl = undefined;
        if (env_1.env.twilioStatusCallbackUrl) {
            const rawUrl = env_1.env.twilioStatusCallbackUrl.trim();
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl);
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
                validatedCallbackUrl = rawUrl;
                console.log('  ✅ StatusCallback URL válida');
            }
            else {
                console.warn('  ⚠️ StatusCallback URL inválida - NO se enviará');
            }
        }
        const messageParams = {
            from: env_1.env.twilioWhatsappFrom,
            to: `whatsapp:${formattedPhone}`,
            contentSid: contentSid,
            contentVariables: JSON.stringify(contentVariables),
        };
        if (validatedCallbackUrl) {
            messageParams.statusCallback = validatedCallbackUrl;
            console.log('📡 Enviando CON statusCallback:', validatedCallbackUrl);
        }
        const message = await client.messages.create(messageParams);
        console.log(`✅ Mensaje con template dinámico enviado exitosamente`);
        console.log(`   - SID: ${message.sid}`);
        console.log(`   - Estado: ${message.status}`);
        console.log(`   - Template: ${contentSid}`);
        console.log(`   - ErrorCode: ${message.errorCode || 'ninguno'}`);
        console.log(`   - ErrorMessage: ${message.errorMessage || 'ninguno'}`);
        return message;
    }
    catch (error) {
        console.error('❌ Error enviando template dinámico:', error.message);
        if (error.code) {
            console.error(`   - Código de error Twilio: ${error.code}`);
        }
        throw error;
    }
};
exports.sendDynamicTemplateMessage = sendDynamicTemplateMessage;
