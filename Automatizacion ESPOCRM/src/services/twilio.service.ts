import twilio from 'twilio';
import { env } from '../config/env';

const client = twilio(
  env.twilioAccountSid,
  env.twilioAuthToken
);

interface TaskCompletedParams {
  phone: string;
  clientName?: string;
  taskName: string;
}

export const sendTaskCompletedMessage = async ({
  phone,
  clientName,
  taskName,
}: TaskCompletedParams) => {
  if (!phone) throw new Error('El número de teléfono es requerido');

  // Validar formato de teléfono (debe incluir código de país)
  // Remove spaces and non-digit characters except leading '+'
  const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
  const formattedPhone = cleanedPhone.startsWith('+') ? cleanedPhone : `+${cleanedPhone}`;
  
  console.log(`📱 Enviando WhatsApp a: ${formattedPhone}`);

  try {
    const message = await client.messages.create({
      from: env.twilioWhatsappFrom,
      to: `whatsapp:${formattedPhone}`,
      contentSid: env.twilioTemplateSid,
      contentVariables: JSON.stringify({
        1: clientName || 'Cliente',
        2: taskName,
      }),
    });

    console.log(`✅ Mensaje de WhatsApp enviado exitosamente`);
    console.log(`   - SID: ${message.sid}`);
    console.log(`   - Estado: ${message.status}`);
    console.log(`   - Template: ${env.twilioTemplateSid}`);
    
    return message;
  } catch (error: any) {
    console.error('❌ Error enviando WhatsApp:', error.message);
    if (error.code) {
      console.error(`   - Código de error Twilio: ${error.code}`);
    }
    throw error;
  }
};

interface QuoteFollowUpParams {
  phone: string;
  clientName?: string;
  quoteName: string;
  pdfUrl?: string;
}

export const sendQuoteFollowUpMessage = async ({
  phone,
  clientName,
  quoteName,
  pdfUrl,
}: QuoteFollowUpParams) => {
  if (!phone) throw new Error('El número de teléfono es requerido');

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
    let validatedCallbackUrl: string | undefined = undefined;
    
    if (env.twilioStatusCallbackUrl) {
      const rawUrl = env.twilioStatusCallbackUrl.trim(); // Eliminar espacios
      
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
      } else {
        console.warn('  ⚠️ URL INVÁLIDA - NO se enviará statusCallback');
        if (!hasProtocol) console.warn('     → Falta protocolo https://');
        if (hasDoubleUrl) console.warn('     → URL duplicada detectada');
        if (hasSpace) console.warn('     → Contiene espacios');
        if (hasUnderscore) console.warn('     → Hostname con guión bajo (_)');
      }
    } else {
      console.log('\n⚠️ [VALIDACIÓN] twilioStatusCallbackUrl no está definida en .env');
    }
    console.log('========================================\n');

    // Build message params WITH statusCallback (override Twilio Console settings)
    const messageParams: any = {
      from: env.twilioWhatsappFrom,
      to: `whatsapp:${formattedPhone}`,
      contentSid: env.twilioQuoteTemplateSid,
      contentVariables: JSON.stringify(variables),
    };

    // Solo agregar statusCallback si la URL es válida
    if (validatedCallbackUrl) {
      messageParams.statusCallback = validatedCallbackUrl;
      console.log('📡 Enviando CON statusCallback:', validatedCallbackUrl);
    } else {
      console.log('📡 Enviando SIN statusCallback (puede causar error 21609 si hay config errónea en Twilio)');
    }

    const message = await client.messages.create(messageParams);

    // Log completo para debugging
    console.log(`✅ Mensaje de seguimiento de Quote enviado exitosamente`);
    console.log(`   - SID: ${message.sid}`);
    console.log(`   - Estado: ${message.status}`);
    console.log(`   - Template: ${env.twilioQuoteTemplateSid}`);
    console.log(`   - ErrorCode: ${message.errorCode || 'ninguno'}`);
    console.log(`   - ErrorMessage: ${message.errorMessage || 'ninguno'}`);
    console.log(`   - From: ${message.from}`);
    console.log(`   - To: ${message.to}`);
    console.log(`   📊 Respuesta completa de Twilio:`, JSON.stringify(message, null, 2));
    
    return message;
  } catch (error: any) {
    console.error('❌ Error enviando WhatsApp de seguimiento:', error.message);
    if (error.code) {
      console.error(`   - Código de error Twilio: ${error.code}`);
    }
    throw error;
  }
};

interface SendTextParams {
  phone: string;
  text: string;
  statusCallback?: string;
}

export const sendTextMessage = async ({
  phone,
  text,
  statusCallback,
}: SendTextParams) => {
  if (!phone) throw new Error('El número de teléfono es requerido');
  if (!text) throw new Error('El mensaje de texto es requerido');

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
    const messageParams: any = {
      from: env.twilioWhatsappFrom,
      to: `whatsapp:${formattedPhone}`,
      body: text,
    };

    // Only add statusCallback if it's a valid URL
    if (statusCallback) {
      console.log(`✅ [DEBUG] Agregando statusCallback: ${statusCallback}`);
      messageParams.statusCallback = statusCallback;
    } else {
      console.log(`⚠️ [DEBUG] NO se agregó statusCallback (valor: ${statusCallback})`);
    }

    console.log(`📦 [DEBUG] messageParams final:`, JSON.stringify(messageParams, null, 2));

    const message = await client.messages.create(messageParams);

    console.log(`✅ Mensaje de texto enviado exitosamente`);
    console.log(`   - SID: ${message.sid}`);
    
    return message;
  } catch (error: any) {
    console.error('❌ Error enviando mensaje de texto:', error.message);
    if (error.code) {
      console.error(`   - Código de error Twilio: ${error.code}`);
    }
    throw error;
  }
};