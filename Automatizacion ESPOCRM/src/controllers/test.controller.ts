import { Request, Response } from 'express';
import { sendTextMessage } from '../services/twilio.service';
import { env } from '../config/env';

export const testWhatsApp = async (_req: Request, res: Response) => {
  try {
    const testPhone = env.testPhoneNumber || '+584121292194';
    
    console.log('🧪 [TEST] Llamando sendTextMessage...');
    console.log('🧪 [TEST] Phone:', testPhone);
    console.log('🧪 [TEST] StatusCallback será:', undefined);
    
    await sendTextMessage({
      phone: testPhone,
      text: '🧪 Este es un mensaje de PRUEBA sin template. Si lo ves, significa que Twilio funciona correctamente.',
    });

    res.json({ 
      success: true, 
      message: `Mensaje de prueba enviado a ${testPhone}. Revisa tu WhatsApp.`,
      note: 'Este mensaje NO usa templates, solo texto plano. Si llega, el problema es específico del template de cotizaciones.'
    });
  } catch (error: any) {
    console.error('🧪 [TEST] Error completo:', error);
    res.status(500).json({ error: error.message });
  }
};

export const testTemplateMessage = async (_req: Request, res: Response) => {
  try {
    const testPhone = env.testPhoneNumber || '+584121292194';
    const { sendQuoteFollowUpMessage } = await import('../services/twilio.service');
    
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
      1. Que el template ${env.twilioQuoteTemplateSid} esté APROBADO
      2. Que el template esté asociado al sender ${env.twilioWhatsappFrom}
      3. Busca el SID del mensaje en Messaging > Logs
      `
    });
  } catch (error: any) {
    res.status(500).json({ 
      error: error.message,
      hint: 'Si el error menciona "template" o "content", verifica que el template esté aprobado en Twilio para tu número de producción.'
    });
  }
};
