import { Request, Response } from 'express';
import { EspoCRMClient } from '../services/espocrm-api-client.service';
import { sendTextMessage } from '../services/twilio.service';
import { env } from '../config/env';

const espoClient = new EspoCRMClient();

// Map Twilio Status to EspoCRM Status
const mapTwilioStatusToEspo = (twilioStatus: string): string => {
  switch (twilioStatus.toLowerCase()) {
    case 'queued':
    case 'sent':
      return 'Sent';
    case 'delivered':
      return 'Delivered';
    case 'read':
      return 'Read';
    case 'failed':
    case 'undelivered':
      return 'Error';
    default:
      return 'Sent';
  }
};

/* Helper: Get Contact ID from External PHP */
import axios from 'axios';
const getContactIdFromExternalScript = async (phone: string): Promise<string | null> => {
  try {
    const url = `https://nc.salesontop.com/WhatsApp/message_get_contact_id.php?telefono=${encodeURIComponent(phone)}`;
    console.log(`🌍 Consultando script externo: ${url}`);
    
    // El script retorna el ID o vacío
    const response = await axios.get(url, {
      timeout: 5000 // 5s timeout
    });
    
    const contactId = response.data ? String(response.data).trim() : null;
    
    if (contactId) {
      console.log(`✅ ID de Contacto recuperado: ${contactId}`);
      return contactId;
    }
    
    console.log('ℹ️ Script externo no retornó ID (Desconocido)');
    return null;
  } catch (error: any) {
    console.warn(`⚠️ Error consultando script externo: ${error.message}`);
    return null;
  }
};

export class WhatsappController {
  
  // Handle Incoming Message (Twilio Webhook)
  static async handleIncomingMessage(req: Request, res: Response) {
    try {
      const { From, Body, MessageSid, NumMedia } = req.body;
      console.log('📨 Mensaje Entrante Twilio:', { From, Body, MessageSid, NumMedia });

      const { MediaService } = await import('../services/media.service'); // Dynamic import or top level


      // Permitimos Body vacío si hay adjuntos (NumMedia > 0)
      const hasMedia = parseInt(NumMedia || '0') > 0;
      if (!From || (!Body && !hasMedia)) {
         res.status(400).send('Missing From or Body');
         return;
      }

      // Cleanup Phone (Twilio sends whatsapp:+123456)
      const phone = From.replace('whatsapp:', '');

      // 1. Buscar o Crear Conversación
      // Asumimos que podemos buscar por nombre (teléfono) o tenemos un campo phone
      // En este caso, buscaremos por 'name' que asumimos contiene el número
      let conversationId: string = '';
      let contactId: string | null = null;
      
      // 1. Consultar Contacto Externo
      contactId = await getContactIdFromExternalScript(phone);

      // 2. Buscar Conversación Existente
      let conversations: any[] = [];

      if (contactId) {
        // A. Si tenemos Contacto, buscar conversación vinculada a ese Contacto
        console.log(`🔍 Buscando conversación por Contact ID: ${contactId}`);
        conversations = await espoClient.searchEntities('WhatsappConverstion', [
           {
             type: 'equals',
             attribute: 'contactId', // Asumiendo campo de enlace estándar
             value: contactId
           }
        ]);
        
        // Si no encuentra por ID de contacto, intentamos un fallback por teléfono por si acaso
        if (conversations.length === 0) {
            console.log(`ℹ️ No se halló conversación por Contact ID, intentando por teléfono...`);
        }
      }

      // B. Si no hay contacto o no se halló conv, buscar por Nombre (Teléfono)
      if (conversations.length === 0) {
           console.log(`🔍 Buscando conversación por Teléfono (Name): ${phone}`);
           // Usamos búsqueda 'contains' para mayor flexibilidad como fallback
           conversations = await espoClient.searchEntities('WhatsappConverstion', [
            {
              type: 'contains', // Contains es más permisivo que equals
              attribute: 'name',
              value: phone.replace(/\D/g, '').slice(-7) // Minimizamos a 7 digitos para catch-all
            }
          ]);
          // Filtrado básico post-búsqueda
          const normalized = phone.replace(/\D/g, '');
          conversations = conversations.filter(c => {
             const cPhone = c.name.replace(/\D/g, '');
             return cPhone.endsWith(normalized) || normalized.endsWith(cPhone);
          });
      }

      if (conversations.length > 0) {
        conversationId = conversations[0].id; // Usar la primera encontrada
        console.log(`✅ Conversación existente seleccionada: ${conversationId}`);
      } else {
        console.log(`✨ No se encontró conversación previa. Se dejará que EspoCRM la cree automáticamente al recibir el mensaje.`);
        // NO creamos conversación manual para evitar duplicados.
        // EspoCRM generará una al recibir el WhatsappMessage sin ID de conversación.
      }

      // 3. Crear Mensaje en EspoCRM
      const newMessageData: any = {
        name: phone,
        status: 'Delivered', 
        type: 'In',
        description: Body || (hasMedia ? '📎 [Archivo Adjunto]' : ''), 
        messageSid: MessageSid, 
        isRead: false
      };

      // Si tenemos ID de conversación, lo vinculamos. Si no, EspoCRM creará una.
      if (conversationId) {
        newMessageData.whatsappConverstionId = conversationId;
      }
      
      // Vincular Contacto al MENSAJE también (User Request)
      if (contactId) {
          newMessageData.contactId = contactId;
      } else {
         // Fallback manual solicitado
         newMessageData.contact = phone;
      }

      const newMessage = await espoClient.createEntity('WhatsappMessage', newMessageData);

      // [REMOVED] Bloque PUT redundante que causaba duplicados
      // El linking ya se envió en el POST (whatsappConverstionId)

      // 3. Actualizar Conversación (Último mensaje y fecha)
      if (conversationId) {
          console.log(`📝 Actualizando Conversación ${conversationId} con último mensaje...`);
          await espoClient.updateEntity('WhatsappConverstion', conversationId, {
            description: Body, 
            fechaHoraUltimoMensaje: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
      }

      // 4. Procesar Media (Si existe)
      const numMedia = parseInt(NumMedia || '0', 10);
      if (numMedia > 0) {
        console.log(`📎 Procesando ${numMedia} archivos adjuntos...`);
        
        // Procesar asincronamente para no bloquear respuesta ??? 
        // Twilio espera < 15s. Si son archivos grandes, mejor responder y procesar en background o usar Promise.all
        // Vamos a intentar Promise.all pero sin awaitar TODO si queremos responder rápido? 
        // El usuario pidió "registro en base de datos". Si falla, deberíamos saberlo.
        // Haremos await por simplicidad y robustez inicial, a menos que sean videos gigantes.
        
        const mediaPromises = [];
        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = req.body[`MediaUrl${i}`];
          const mediaContentType = req.body[`MediaContentType${i}`];
          
          if (mediaUrl) {
            mediaPromises.push((async () => {
              try {
                console.log(`   > Procesando media #${i}: ${mediaContentType}`);
                const uploadedData = await MediaService.processMediaItem(mediaUrl, mediaContentType);
                
                // Crear entidad WhatsappMedia en EspoCRM
                const mediaData = {
                  name: uploadedData.url, // User requested full URL as the name/identifier
                  fileName: uploadedData.fileName,
                  url: uploadedData.url,
                  mimeType: uploadedData.mimeType,
                  category: uploadedData.category,
                  size: uploadedData.size,
                  messageId: newMessage.id, // Id del mensaje creado arriba
                  whatsappMessageId: newMessage.id, // Alternativa por si la relación usa este nombre
                };

                await espoClient.createEntity('WhatsappMedia', mediaData);
                console.log(`   ✅ Media registrada en EspoCRM: ${uploadedData.fileName}`);
                
              } catch (err: any) {
                console.error(`   ❌ Error procesando media #${i}:`, err.message);
              }
            })());
          }
        }

        // Esperamos a que terminen para asegurar consistencia
        await Promise.all(mediaPromises);
      }

      res.status(200).send('<Response></Response>'); // Twilio expects XML or empty
    } catch (error: any) {
      console.error('Error handling incoming message:', error);
      res.status(500).send(error.message);
    }
  }

  // Handle Outgoing Message (EspoCRM Webhook)
  static async handleOutgoingMessage(req: Request, res: Response) {
    try {
      // EspoCRM webhook payload (variable structure depending on configuration)
      // Usually entity data is in req.body
      const entity = req.body;
      console.log('📤 Webhook Saliente EspoCRM:', entity.id);

      if (entity.type !== 'Out') {
        console.log('ℹ️ Ignorando mensaje que no es type="Out"');
        res.status(200).send({ status: 'ignored' });
        return;
      }

      // FIX: Evitar bucle infinito si el mensaje ya tiene un SID (fue creado por nuestro Job)
      if (entity.messageSid) {
        console.log(`ℹ️ Ignorando mensaje que ya tiene SID (enviado por Job Automático): ${entity.messageSid}`);
        res.status(200).send({ status: 'ignored', reason: 'already_sent' });
        return;
      }

      // Validar datos
      const phone = entity.name; // User said name stores phone
      const text = entity.text || entity.description; // Fallback
      
      if (!phone || !text) {
        console.error('❌ Falta teléfono o texto en la entidad');
         res.status(400).send('Missing phone or text');
         return;
      }

      // Enviar por Twilio
      const callbackUrl = env.twilioStatusCallbackUrl;
      const message = await sendTextMessage({
        phone,
        text,
        statusCallback: callbackUrl
      });

      // Actualizar EspoCRM con el SID para tracking
      if (message.sid) {
        await espoClient.updateEntity('WhatsappMessage', entity.id, {
          messageSid: message.sid,
          status: 'Sent'
        });
      }

      res.status(200).send({ status: 'sent', sid: message.sid });

    } catch (error: any) {
      console.error('Error handling outgoing message:', error);
      res.status(500).send(error.message);
    }
  }

  // Handle Status Update (Twilio StatusCallback)
  static async handleStatusUpdate(req: Request, res: Response) {
    try {
      const { MessageSid, MessageStatus } = req.body;
      console.log(`🔔 Actualización de Estado Twilio: ${MessageSid} -> ${MessageStatus}`);

      if (!MessageSid) {
         res.status(400).send('Missing MessageSid');
         return;
      }

      // 1. Buscar el mensaje en EspoCRM por messageSid
      const messages = await espoClient.searchEntities('WhatsappMessage', [
        {
          type: 'equals',
          attribute: 'messageSid', // CAMPO CREADO MANUALMENTE
          value: MessageSid
        }
      ]);

      if (messages.length === 0) {
        console.warn(`⚠️ Mensaje con SID ${MessageSid} no encontrado en EspoCRM`);
         res.status(200).send('Message not found'); // Return 200 to stop Twilio retries
         return;
      }

      const messageId = messages[0].id;
      const newStatus = mapTwilioStatusToEspo(MessageStatus);

      // 2. Actualizar estado
      if (newStatus !== messages[0].status) {
        await espoClient.updateEntity('WhatsappMessage', messageId, {
          status: newStatus
        });
      }

      res.status(200).send('OK');
    } catch (error: any) {
      console.error('Error handling status update:', error);
      res.status(500).send(error.message);
    }
  }
}
// Legacy function to support existing webhook.routes.ts
export const taskCompleted = async (req: Request, res: Response) => {
  try {
    const { phone, clientName, taskName } = req.body;
    console.log('✅ Webhook Task Completed recibido:', { phone, clientName, taskName });

    const { sendTaskCompletedMessage } = await import('../services/twilio.service');
    
    await sendTaskCompletedMessage({
      phone,
      clientName,
      taskName
    });

    res.status(200).send({ success: true });
  } catch (error: any) {
    console.error('Error en taskCompleted:', error);
    res.status(500).send(error.message);
  }
};
