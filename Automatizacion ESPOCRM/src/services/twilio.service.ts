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
  const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
  
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
  const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
  
  console.log(`📱 Enviando WhatsApp de seguimiento de Quote a: ${formattedPhone}`);

  try {
    const variables = {
      1: pdfUrl || '', // Variable {{1}} es MEDIA (PDF)
      2: clientName || 'Cliente', // Variable {{2}} es NOMBRE
      3: quoteName, // Variable {{3}} es COTIZACION
    };

    console.log(`📦 Variables enviadas a Twilio:`, JSON.stringify(variables));

    const message = await client.messages.create({
      from: env.twilioWhatsappFrom,
      to: `whatsapp:${formattedPhone}`,
      contentSid: env.twilioQuoteTemplateSid,
      contentVariables: JSON.stringify(variables),
    });

    console.log(`✅ Mensaje de seguimiento de Quote enviado exitosamente`);
    console.log(`   - SID: ${message.sid}`);
    console.log(`   - Estado: ${message.status}`);
    console.log(`   - Template: ${env.twilioQuoteTemplateSid}`);
    
    return message;
  } catch (error: any) {
    console.error('❌ Error enviando WhatsApp de seguimiento:', error.message);
    if (error.code) {
      console.error(`   - Código de error Twilio: ${error.code}`);
    }
    throw error;
  }
};

