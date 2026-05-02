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
      console.log('📨 Mensaje Entrante Twilio (Payload Completo):', JSON.stringify(req.body, null, 2));

      const { MediaService } = await import('../services/media.service'); // Dynamic import or top level


      // Permitimos Body vacío si hay adjuntos (NumMedia > 0)
      const hasMedia = parseInt(NumMedia || '0') > 0;
      console.log(`🔍 Validación: HasMedia=${hasMedia}, Body="${Body}", NumMediaRaw="${NumMedia}"`);
      
      if (!From || (!Body && !hasMedia)) {
         console.warn('❌ Rechazado por validación (Falta Body y no hay Media)');
         res.status(400).send('Missing From or Body');
         return;
      }

      // Cleanup Phone (Twilio sends whatsapp:+123456)
      const phone = From.replace('whatsapp:', '');

      // =============================================
      // DETECCIÓN DE QUICK REPLY: "Solicitar mi XML"
      // =============================================
      // Cuando el cliente presiona el botón "Solicitar mi XML" en WhatsApp,
      // Twilio envía el texto del botón como Body del mensaje entrante.
      // Detectamos esto y enviamos el XML como mensaje libre (free-form).
      const buttonPayload = req.body.ButtonPayload || '';
      const isXmlRequest = (
        (Body && Body.trim().toLowerCase() === 'solicitar mi xml') ||
        buttonPayload === 'solicitar_xml'
      );

      if (isXmlRequest) {
        console.log(`\n📎 ============================================`);
        console.log(`📎 Quick Reply "Solicitar mi XML" detectado de: ${phone}`);
        console.log(`📎 ============================================\n`);

        const { xmlPendingStore } = await import('../services/xml-pending-store');
        const { sendMediaMessage } = await import('../services/twilio.service');

        const pendingXml = xmlPendingStore.get(phone);

        if (pendingXml) {
          console.log(`✅ XML pendiente encontrado: ${pendingXml.cachedFiles.length} archivo(s) para factura "${pendingXml.invoiceName}"`);

          // ⚠️ Twilio NO soporta XML como media adjunta en WhatsApp (error 63019).
          // Tipos soportados: PDF, DOC, DOCX, PPTX, XLSX únicamente.
          // Solución: enviar mensaje de texto con link de descarga directa.
          // El endpoint /api/xml-cache/:token sirve el archivo desde memoria (~0ms).
          let validatedCallbackUrl: string | undefined = undefined;
          if (env.twilioStatusCallbackUrl) {
            const rawUrl = env.twilioStatusCallbackUrl.trim();
            const hasProtocol = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
            const hasDoubleUrl = /https?:\/\/.*https?:\/\//.test(rawUrl);
            const hasSpace = /\s/.test(rawUrl);
            const hasUnderscore = /:\/\/[^/]*_/.test(rawUrl);
            if (hasProtocol && !hasDoubleUrl && !hasSpace && !hasUnderscore) {
              validatedCallbackUrl = rawUrl;
            }
          }

          // Construir links de descarga con tokens de cache
          const downloadLinks = pendingXml.cachedFiles.map(f => {
            const cacheUrl = `${env.publicUrl}/api/xml-cache/${f.token}`;
            return `📄 ${f.fileName}\n${cacheUrl}`;
          }).join('\n\n');

          const textMessage = `📎 *XML de tu factura: ${pendingXml.invoiceName}*\n\nDescarga tu archivo XML aquí:\n\n${downloadLinks}\n\n_Toca el enlace para descargar._`;

          let xmlMsgSid: string | undefined;
          try {
            const xmlMsgResult = await sendTextMessage({
              phone,
              text: textMessage,
              statusCallback: validatedCallbackUrl,
            });
            xmlMsgSid = xmlMsgResult?.sid;
            console.log(`✅ Link de descarga de XML enviado exitosamente (SID: ${xmlMsgSid})`);
          } catch (xmlErr: any) {
            console.error(`❌ Error enviando link de XML:`, xmlErr.message);
          }

          // Limpiar del store
          xmlPendingStore.remove(phone);

          // Registrar en EspoCRM (el botón presionado + XML enviado)
          try {
            // Buscar conversación existente para este teléfono
            const convSearch = await espoClient.searchEntities('WhatsappConverstion', [
              { type: 'contains', attribute: 'name', value: phone.replace(/\D/g, '').slice(-7) }
            ]);
            const normalizedPhone = phone.replace(/\D/g, '');
            const matchedConv = convSearch.find((c: any) => {
              const cPhone = c.name.replace(/\D/g, '');
              return cPhone.endsWith(normalizedPhone) || normalizedPhone.endsWith(cPhone);
            });

            if (matchedConv) {
              // 1. Guardar el mensaje entrante (botón presionado por el cliente)
              await espoClient.createEntity('WhatsappMessage', {
                name: phone,
                status: 'Delivered',
                type: 'In',
                description: 'Solicitar mi XML',
                messageSid: MessageSid,
                isRead: true,
                whatsappConverstionId: matchedConv.id,
              });

              // 2. Guardar el mensaje saliente (link de descarga del XML enviado)
              await espoClient.createEntity('WhatsappMessage', {
                name: phone,
                status: 'Sent',
                type: 'Out',
                description: textMessage,
                messageSid: xmlMsgSid || `xml_link_${Date.now()}`,
                isRead: false,
                whatsappConverstionId: matchedConv.id,
              });

              // 3. Actualizar conversación con el último mensaje
              await espoClient.updateEntity('WhatsappConverstion', matchedConv.id, {
                description: textMessage,
                fechaHoraUltimoMensaje: new Date().toISOString().slice(0, 19).replace('T', ' '),
              });
            }
          } catch (logErr: any) {
            console.warn(`⚠️ Error registrando Quick Reply en EspoCRM (XML sí se envió):`, logErr.message);
          }

          console.log(`\n✅ Proceso de entrega de XML completado para ${phone}\n`);
        } else {
          console.log(`⚠️ No hay XML pendiente para ${phone}. Posiblemente ya fue enviado o expiró.`);
        }

        res.status(200).send('<Response></Response>');
        return; // Short-circuit: no procesar como mensaje normal
      }
      // =============================================
      // FIN DETECCIÓN QUICK REPLY
      // =============================================

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

      // 4. Procesar Media (Nativo EspoCRM Attachments)
      const numMedia = parseInt(NumMedia || '0', 10);
      if (numMedia > 0) {
        console.log(`📎 Procesando ${numMedia} archivos adjuntos (Modo Nativo Setup)...`);
        
        let firstAttachmentId: string | null = null;

        for (let i = 0; i < numMedia; i++) {
          const mediaUrl = req.body[`MediaUrl${i}`];
          const mediaContentType = req.body[`MediaContentType${i}`];
          
          if (mediaUrl) {
            try {
              console.log(`   > Procesando media #${i}: ${mediaContentType}`);
              
              // 1. Descargar de Twilio
              const { buffer } = await MediaService.downloadMedia(mediaUrl);
              
              // 2. Determinar nombre archivo
              const ext = mediaContentType.split('/')[1] || 'bin';
              const fileName = `whatsapp_${MessageSid}_${i}.${ext}`;

              // 3. Subir como Attachment a EspoCRM linked to WhatsappMessage
              // Enviamos parentType y parentId en la creación.
              const attachment = await espoClient.uploadAttachment(
                buffer, 
                fileName, 
                mediaContentType,
                'WhatsappMessage', // parentType
                newMessage.id      // parentId (ID interno EspoCRM)
              );

              console.log(`   ✅ Attachment subido. ID: ${attachment.id}`);

              // Nota: No se usa linkEntity porque archivoAdjunto es un campo tipo File,
              // no una relación Attachment-Multiple. La vinculación se hace via archivoAdjuntoId.

              // Guardar el primero para vincular al campo personalizado
              if (!firstAttachmentId) {
                firstAttachmentId = attachment.id;
              }

            } catch (err: any) {
              console.error(`   ❌ Error procesando media nativa #${i}:`, err.message);
            }
          }
        }

        // 4. Vincular al campo personalizado 'archivoAdjunto' si existe un adjunto
        if (firstAttachmentId) {
          console.log(`📝 Vinculando archivoAdjuntoId: ${firstAttachmentId} al mensaje ${newMessage.id}`);
          try {
            await espoClient.updateEntity('WhatsappMessage', newMessage.id, {
              archivoAdjuntoId: firstAttachmentId
            });
          } catch (updateErr: any) {
            console.error('   ⚠️ Error vinculando campo archivoAdjunto:', updateErr.message);
          }
        }
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
      const initialEntity = req.body;
      console.log('📤 Webhook Saliente EspoCRM:', initialEntity.id);

      if (initialEntity.type !== 'Out') {
        console.log('ℹ️ Ignorando mensaje que no es type="Out"');
        res.status(200).send({ status: 'ignored' });
        return;
      }

      if (initialEntity.messageSid) {
        console.log(`ℹ️ Ignorando mensaje que ya tiene SID: ${initialEntity.messageSid}`);
        res.status(200).send({ status: 'ignored', reason: 'already_sent' });
        return;
      }

      // 1. Obtener entidad completa para asegurar acceso a campos custom (archivoAdjuntoId)
      console.log(`🔍 Obteniendo detalles completos del mensaje ${initialEntity.id}...`);
      const entity = await espoClient.getEntity('WhatsappMessage', initialEntity.id);
      
      const phone = entity.name; 
      let text = entity.text || entity.description || ''; // Texto opcional si hay media
      const attachmentId = entity.archivoAdjuntoId; // Campo custom usado por el usuario
      // const attachmentIds = entity.attachmentsIds; // Relación nativa (opcional futuro)

      console.log(`   - Phone: ${phone}`);
      console.log(`   - Text: "${text}"`);
      console.log(`   - Attachment ID: ${attachmentId || 'Ninguno'}`);

      if (!phone) {
        console.error('❌ Falta teléfono en la entidad');
        res.status(400).send('Missing phone');
        return;
      }

      if (!text && !attachmentId) {
        console.log('ℹ️ Sin texto ni adjunto — probablemente será enviado via template (whatsapp-init)');
        res.status(200).send({ status: 'ignored', reason: 'no_content_template_init' });
        return;
      }

      const callbackUrl = env.twilioStatusCallbackUrl;
      let message;

      // 2. Enviar Mensaje (Texto o Media)
      if (attachmentId) {
        console.log(`📎 Detectado archivo adjunto: ${attachmentId}. Enviando como Media Message...`);
        
        // Asumimos URL pública en data/upload
        // Si el usuario usa un proxy o regla Rewrite, esto funciona.
        // Si no, Twilio podría fallar si no puede acceder.
        // Espo guarda en data/upload/ID (sin extensión). 
        // Twilio suele requerir extensión o Content-Type correcto en headers.
        // Si la URL directa falla, necesitaremos un proxy en este controller.
        // UPDATE: Usamos el Proxy de Node.js para servir el archivo con headers correctos
        const mediaUrl = `${env.publicUrl}/api/media/proxy/${attachmentId}`;
        
        console.log(`   🔗 Generando URL Proxy para Twilio: ${mediaUrl}`);
        
        const { sendMediaMessage } = await import('../services/twilio.service');
        message = await sendMediaMessage({
          phone,
          body: text, // Puede ir vacío
          mediaUrls: [mediaUrl],
          statusCallback: callbackUrl
        });

      } else {
        console.log(`📝 Enviando mensaje de texto puro...`);
        message = await sendTextMessage({
          phone,
          text,
          statusCallback: callbackUrl
        });
      }

      // 3. Actualizar EspoCRM con el SID
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

