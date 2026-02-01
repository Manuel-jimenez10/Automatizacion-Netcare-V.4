import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env';

export class MediaService {
  
  /**
   * Descarga el archivo de medios desde Twilio.
   * Requiere autenticación Basic Auth usando Account SID y Auth Token.
   */
  static async downloadMedia(mediaUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      console.log(`📥 Descargando media desde: ${mediaUrl}`);
      
      const response = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString('base64')
        }
      });

      console.log(`✅ Descarga completada. Tamaño: ${response.data.length} bytes`);
      
      return {
        buffer: Buffer.from(response.data),
        contentType: response.headers['content-type']
      };
    } catch (error: any) {
      console.error(`❌ Error descargando media: ${error.message}`);
      throw new Error(`Failed to download media: ${error.message}`);
    }
  }

  /**
   * Sube el archivo al endpoint PHP remoto.
   */
  static async uploadToStorage(buffer: Buffer, fileName: string, mimeType: string): Promise<any> {
    const uploadUrl = env.storageUploadUrl; 
    
    if (!uploadUrl) {
      throw new Error('STORAGE_UPLOAD_URL no está definido en el archivo .env');
    }

    try {
      console.log(`📤 Subiendo archivo a: ${uploadUrl}`);

      const form = new FormData();
      form.append('file', buffer, {
        filename: fileName,
        contentType: mimeType,
      });

      // Si se implementó token en PHP, agregarlo aquí
      // form.append('token', env.storageToken); 

      const response = await axios.post(uploadUrl, form, {
        headers: {
          ...form.getHeaders(),
          // 'Authorization': `Bearer ${env.storageToken}` // Si usas Bearer token
        }
      });

      console.log(`✅ Archivo subido exitosamente:`, response.data);
      return response.data;
    } catch (error: any) {
      console.error(`❌ Error subiendo archivo al storage:`, error.response?.data || error.message);
      throw new Error(`Failed to upload media to storage: ${error.message}`);
    }
  }

  /**
   * Procesa un archivo de medio completo (Descarga + Subida)
   */
  static async processMediaItem(mediaUrl: string, originalMimeType: string): Promise<any> {
    // 1. Descargar
    const { buffer, contentType } = await this.downloadMedia(mediaUrl);

    // 2. Determinar extensión
    const ext = contentType.split('/')[1] || 'bin';
    const tempFileName = `twilio_${Date.now()}.${ext}`;

    // 3. Subir
    const uploadResult = await this.uploadToStorage(buffer, tempFileName, contentType);
    
    return uploadResult;
  }
}
