import { Request, Response } from 'express';
import { MediaService } from '../services/media.service';
import { sendMediaMessage } from '../services/twilio.service';
import { EspoCRMClient } from '../services/espocrm-api-client.service';
import { getMimeCategory, ALLOWED_MIME_TYPES, SendMediaRequest } from '../interfaces/media.interface';
import { env } from '../config/env';

const espoClient = new EspoCRMClient();

export class MediaController {
  
  /**
   * POST /api/media/upload
   * Sube un archivo al storage y lo registra en EspoCRM
   */
  static async uploadMedia(req: Request, res: Response) {
    try {
      const file = req.file;
      
      if (!file) {
        res.status(400).json({ error: 'No se recibió ningún archivo' });
        return;
      }

      console.log(`📤 Upload recibido: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`);

      // Validar MIME
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        res.status(415).json({ 
          error: 'Tipo de archivo no permitido',
          received: file.mimetype,
          allowed: ALLOWED_MIME_TYPES
        });
        return;
      }

      // Subir como Attachment a EspoCRM (Nativo)
      const attachment = await espoClient.uploadAttachment(
        file.buffer,
        file.originalname,
        file.mimetype,
        // No vinculamos aún a nada específico, queda "huérfano" hasta que se envíe el mensaje
        // O podríamos vincularlo a un "Global Uploads" si fuera necesario.
        // Espo permite subir sin padre.
      );

      console.log(`✅ Media registrada en EspoCRM (Attachment ID: ${attachment.id})`);

      res.status(201).json({
        success: true,
        mediaId: attachment.id,
        // La URL de descarga directa desde EspoCRM
        url: `${env.espocrmBaseUrl}/?entryPoint=download&id=${attachment.id}`,
        fileName: file.originalname,
        category: getMimeCategory(file.mimetype),
        size: file.size
      });

    } catch (error: any) {
      console.error('❌ Error en upload:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/media/send
   * Envía media por WhatsApp usando Twilio
   */
  static async sendMedia(req: Request, res: Response) {
    try {
      const { to, mediaIds, mediaUrls, body }: SendMediaRequest = req.body;

      if (!to) {
        res.status(400).json({ error: 'Se requiere el número destino (to)' });
        return;
      }

      if ((!mediaIds || mediaIds.length === 0) && (!mediaUrls || mediaUrls.length === 0)) {
        res.status(400).json({ error: 'Se requiere mediaIds o mediaUrls' });
        return;
      }

      let urls: string[] = [];

      // Resolver IDs a URLs si se proporcionaron IDs
      if (mediaIds && mediaIds.length > 0) {
        console.log(`🔍 Buscando ${mediaIds.length} media(s) en EspoCRM (Attachments Nativo)...`);
        
        for (const id of mediaIds) {
          // Usamos el Proxy de Node.js para servir el archivo con headers correctos
          // y autenticación manejada por el backend.
          const publicUrl = `${env.publicUrl}/api/media/proxy/${id}`;
          
          console.log(`   🔗 Generando URL para Attachment ${id}: ${publicUrl}`);
          urls.push(publicUrl);

          // Nota: Si esto falla por falta de extensión, necesitaremos un endpoint proxy en Node.js
          // que sirva el archivo con el Content-Type correcto.
        }
      }

      // Agregar URLs directas si se proporcionaron
      if (mediaUrls && mediaUrls.length > 0) {
        urls = urls.concat(mediaUrls);
      }

      if (urls.length === 0) {
        res.status(404).json({ error: 'No se encontraron URLs válidas para enviar' });
        return;
      }

      // Enviar por Twilio
      const twilioMessage = await sendMediaMessage({
        phone: to,
        mediaUrls: urls,
        body: body,
        statusCallback: env.twilioStatusCallbackUrl
      });

      // Crear mensaje en EspoCRM
      const messageRecord = await espoClient.createEntity('WhatsappMessage', {
        name: to,
        status: 'Sent',
        type: 'Out',
        description: body || '📎 [Media]',
        messageSid: twilioMessage.sid,
      });

      // Vincular medias al mensaje
      if (mediaIds && mediaIds.length > 0) {
        // En EspoCRM, los mensajes pueden tener múltiples adjuntos en la relación 'attachments'
        try {
           // Opción A: Usar el endpoint de uploadAttachment vinculando al padre
           // Pero los archivos ya existen. Debemos vincularlos.
           // Usamos la API de Link para 'attachments'
           for (const mediaId of mediaIds) {
             await espoClient.linkEntity('WhatsappMessage', messageRecord.id, 'attachments', mediaId);
           }
           // Y también al campo personalizado archivoAdjuntoId (solo el primero)
           await espoClient.updateEntity('WhatsappMessage', messageRecord.id, {
             archivoAdjuntoId: mediaIds[0]
           });
        } catch (linkError: any) {
           console.error('⚠️ Error vinculando adjuntos:', linkError.message);
        }
      }

      res.status(200).json({
        success: true,
        messageSid: twilioMessage.sid,
        messageId: messageRecord.id,
        mediasSent: urls.length
      });

    } catch (error: any) {
      console.error('❌ Error enviando media:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
  /**
   * GET /api/media/proxy/:id
   * Sirve archivos de EspoCRM a clientes externos (Twilio)
   * usando la autenticación del backend.
   * 
   * IMPORTANTE: Descarga como buffer completo (no stream) para evitar
   * que Twilio reciba 0 bytes por problemas de redirect/stream.
   */
  static async proxyMedia(req: Request, res: Response) {
    try {
      const { id } = req.params;
      
      if (!id) {
        res.status(400).send('Missing ID');
        return;
      }

      console.log(`🔄 Proxy request para Attachment: ${id}`);

      // 1. Obtener Metadatos para Content-Type
      let contentType = 'application/octet-stream';
      try {
        const attachment = await espoClient.getEntity('Attachment', id);
        
        if (attachment && attachment.type) {
           contentType = attachment.type;
           console.log(`   - Content-Type: ${contentType}`);
        }
      } catch (metaErr) {
        console.warn(`   ⚠️ No se pudieron obtener metadatos para ${id}, se usará Content-Type genérico.`);
      }

      // 2. Descargar archivo completo como buffer (más robusto que streaming)
      const response = await espoClient.getFileAsBuffer(id);
      const fileBuffer: Buffer = Buffer.from(response.data);

      console.log(`   ✅ Archivo descargado: ${fileBuffer.length} bytes`);

      if (fileBuffer.length === 0) {
        console.error(`   ❌ Archivo vacío para Attachment ${id}`);
        res.status(404).send('File is empty');
        return;
      }

      // 3. Enviar con headers explícitos
      
      // FIX/HACK: Twilio/WhatsApp a veces rechaza audio/x-m4a o audio/m4a
      // Lo mapeamos a audio/mp4 que es más universal para este contenedor
      if (contentType === 'audio/x-m4a' || contentType === 'audio/m4a') {
        console.log(`   ⚠️ Mapeando Content-Type ${contentType} -> audio/mp4 para compatibilidad con Twilio`);
        contentType = 'audio/mp4';
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileBuffer.length);
      res.status(200).send(fileBuffer);

    } catch (error: any) {
      console.error(`❌ Error en proxyMedia ${req.params.id}:`, error.message);
      res.status(404).send('File not found or inaccessible');
    }
  }
}
