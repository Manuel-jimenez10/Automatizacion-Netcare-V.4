import { Request, Response } from 'express';
import { TaskCompletionService } from '../services/task-completion.service';
import { env } from '../config/env';

const taskCompletionService = new TaskCompletionService();

export const taskCompleted = async (req: Request, res: Response) => {
  try {
    console.log('\n📥 Webhook recibido desde EspoCRM');
    console.log('📥 Payload:', JSON.stringify(req.body, null, 2));

    // 1. VALIDAR SECRET KEY (Seguridad)
    const signature = req.headers['x-signature'] as string;
    
    if (!signature) {
      console.log('❌ Falta el header X-Signature');
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Missing X-Signature header' 
      });
    }

    // Validar que la signature coincida con nuestra secret key
    if (signature !== env.webhookSecret) {
      console.log('❌ X-Signature inválida');
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'Invalid webhook signature' 
      });
    }

    console.log('✅ Secret key validada correctamente');

    // 2. VALIDAR PAYLOAD

    const { taskId } = req.body;

    // Validar que taskId esté presente
    if (!taskId) {
      console.log('❌ taskId faltante en el payload');
      return res.status(400).json({ 
        error: 'Bad Request',
        message: 'taskId es requerido en el payload' 
      });
    }

    // Delegar toda la lógica al servicio orquestador
    await taskCompletionService.handleTaskCompletion(taskId);

    return res.status(200).json({ 
      success: true,
      message: 'Mensaje de WhatsApp enviado exitosamente',
      taskId: taskId
    });

  } catch (error: any) {
    console.error('❌ Error en el controlador:', error.message);

    // Determinar código de error HTTP apropiado
    let statusCode = 500;
    let errorType = 'Internal Server Error';

    if (error.message.includes('no encontrada') || error.message.includes('no encontrado')) {
      statusCode = 404;
      errorType = 'Not Found';
    } else if (error.message.includes('no tiene') || error.message.includes('requerido')) {
      statusCode = 400;
      errorType = 'Bad Request';
    }

    return res.status(statusCode).json({ 
      error: errorType,
      message: error.message 
    });
  }
};

