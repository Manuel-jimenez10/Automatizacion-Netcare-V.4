import { Request, Response } from 'express';
import { sendTaskCompletedMessage } from '../services/twilio.service';

/**
 * RUTA DE PRUEBA - Solo para testing
 * Envía un WhatsApp con datos hardcodeados sin tocar EspoCRM
 */
export const testWhatsApp = async (req: Request, res: Response) => {
  try {
    console.log('\n🧪 ============================================');
    console.log('🧪 PRUEBA: Enviando WhatsApp con datos hardcodeados');
    console.log('🧪 ============================================\n');

    // Datos hardcodeados para la prueba
    // IMPORTANTE: Cambia este número por tu número de WhatsApp personal para recibir la prueba
    const testPhone = '+584121292194'; // 👈 CAMBIA ESTE NÚMERO
    const testClientName = 'Juan Pérez (PRUEBA)';
    const testTaskName = 'Revisión de documentos fiscales (PRUEBA)';

    console.log('📱 Número de prueba:', testPhone);
    console.log('👤 Cliente de prueba:', testClientName);
    console.log('📋 Task de prueba:', testTaskName);
    console.log('');

    // Enviar el mensaje de WhatsApp
    await sendTaskCompletedMessage({
      phone: testPhone,
      clientName: testClientName,
      taskName: testTaskName,
    });

    console.log('\n✅ ============================================');
    console.log('✅ PRUEBA EXITOSA: WhatsApp enviado');
    console.log('✅ ============================================\n');

    return res.status(200).json({
      success: true,
      message: 'WhatsApp de prueba enviado exitosamente',
      data: {
        phone: testPhone,
        clientName: testClientName,
        taskName: testTaskName,
      },
    });

  } catch (error: any) {
    console.error('\n❌ ============================================');
    console.error('❌ ERROR EN PRUEBA:', error.message);
    console.error('❌ ============================================\n');

    return res.status(500).json({
      error: 'Test Failed',
      message: error.message,
      details: error.code || 'No error code available',
    });
  }
};
