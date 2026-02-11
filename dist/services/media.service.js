"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaService = void 0;
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const env_1 = require("../config/env");
const media_interface_1 = require("../interfaces/media.interface");
class MediaService {
    /**
     * Valida que el MIME type esté permitido
     */
    static isValidMimeType(mimeType) {
        return media_interface_1.ALLOWED_MIME_TYPES.includes(mimeType);
    }
    /**
     * Descarga el archivo de medios desde Twilio.
     * Requiere autenticación Basic Auth usando Account SID y Auth Token.
     * Incluye reintentos para manejar errores transitorios de red (ENOTFOUND, EAI_AGAIN).
     */
    static async downloadMedia(mediaUrl, retries = 3) {
        let lastError;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`📥 Descargando media desde: ${mediaUrl} (Intento ${attempt}/${retries})`);
                const response = await axios_1.default.get(mediaUrl, {
                    responseType: 'arraybuffer',
                    headers: {
                        'Authorization': 'Basic ' + Buffer.from(`${env_1.env.twilioAccountSid}:${env_1.env.twilioAuthToken}`).toString('base64'),
                        'User-Agent': 'Node-Espo-Automation/1.0'
                    },
                    timeout: 10000 // 10s timeout
                });
                console.log(`✅ Descarga completada. Tamaño: ${response.data.length} bytes`);
                return {
                    buffer: Buffer.from(response.data),
                    contentType: response.headers['content-type']
                };
            }
            catch (error) {
                lastError = error;
                console.warn(`⚠️ Error en intento ${attempt} descargando media: ${error.message}`);
                // Esperar antes de reintentar (backoff exponencial: 1s, 2s, 4s...)
                if (attempt < retries) {
                    const delay = 1000 * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        console.error(`❌ Fallaron todos los intentos de descarga de media.`);
        throw new Error(`Failed to download media after ${retries} attempts: ${lastError?.message}`);
    }
    /**
     * Sube el archivo al endpoint PHP remoto.
     */
    static async uploadToStorage(buffer, fileName, mimeType) {
        const uploadUrl = env_1.env.storageUploadUrl;
        if (!uploadUrl) {
            throw new Error('STORAGE_UPLOAD_URL no está definido en el archivo .env');
        }
        try {
            console.log(`📤 Subiendo archivo a: ${uploadUrl}`);
            const form = new form_data_1.default();
            form.append('file', buffer, {
                filename: fileName,
                contentType: mimeType,
            });
            const headers = { ...form.getHeaders() };
            // Agregar token de autenticación si está configurado
            if (env_1.env.storageToken) {
                headers['Authorization'] = `Bearer ${env_1.env.storageToken}`;
            }
            const response = await axios_1.default.post(uploadUrl, form, { headers });
            console.log(`✅ Archivo subido exitosamente:`, response.data);
            return response.data;
        }
        catch (error) {
            console.error(`❌ Error subiendo archivo al storage:`, error.response?.data || error.message);
            throw new Error(`Failed to upload media to storage: ${error.message}`);
        }
    }
    /**
     * Procesa un archivo de medio completo (Descarga + Subida)
     * Usado para mensajes entrantes de Twilio
     */
    static async processMediaItem(mediaUrl, originalMimeType) {
        // 1. Descargar
        const { buffer, contentType } = await this.downloadMedia(mediaUrl);
        // 2. Determinar extensión
        const ext = contentType.split('/')[1] || 'bin';
        const tempFileName = `twilio_${Date.now()}.${ext}`;
        // 3. Subir
        const uploadResult = await this.uploadToStorage(buffer, tempFileName, contentType);
        return uploadResult;
    }
    /**
     * Sube un archivo desde el CRM al storage PHP.
     * Usado para uploads desde la interfaz del CRM.
     */
    static async uploadFromCRM(buffer, fileName, mimeType) {
        const uploadUrl = env_1.env.storageUploadUrl;
        if (!uploadUrl) {
            throw new Error('STORAGE_UPLOAD_URL no está definido');
        }
        // Validar MIME
        if (!this.isValidMimeType(mimeType)) {
            throw new Error(`Tipo de archivo no permitido: ${mimeType}`);
        }
        console.log(`📤 Subiendo archivo CRM a: ${uploadUrl}`);
        console.log(`   - Archivo: ${fileName} (${mimeType})`);
        const form = new form_data_1.default();
        form.append('file', buffer, {
            filename: fileName,
            contentType: mimeType,
        });
        const headers = { ...form.getHeaders() };
        // Agregar token de autenticación si está configurado
        if (env_1.env.storageToken) {
            headers['Authorization'] = `Bearer ${env_1.env.storageToken}`;
        }
        const response = await axios_1.default.post(uploadUrl, form, { headers });
        if (!response.data.success) {
            throw new Error(response.data.error || 'Error desconocido al subir archivo');
        }
        console.log(`✅ Archivo CRM subido exitosamente:`, response.data.url);
        return response.data;
    }
}
exports.MediaService = MediaService;
