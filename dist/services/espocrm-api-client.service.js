"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EspoCRMClient = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
class EspoCRMClient {
    constructor() {
        this.client = axios_1.default.create({
            baseURL: env_1.env.espocrmBaseUrl,
            headers: {
                'X-Api-Key': env_1.env.espocrmApiKey,
                'Content-Type': 'application/json',
            },
        });
    }
    // Método genérico para hacer requests
    async request(method, endpoint, data) {
        try {
            // Asegurar que no haya doble slash //
            const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
            const dbgUrl = `/api/v1/${cleanEndpoint}`; // Leading slash ensures proper URL joining
            console.log(`📡 Requesting: ${method} ${this.client.defaults.baseURL}${dbgUrl}`);
            const response = await this.client.request({
                method,
                url: dbgUrl,
                data,
            });
            return response.data;
        }
        catch (error) {
            // Manejo de errores
            console.error('EspoCRM API Error:', error.response?.status, error.response?.data);
            // Incluir URL en el error para debugging
            const fullUrl = `${this.client.defaults.baseURL}/api/v1/${endpoint}`;
            throw new Error(`Error EspoCRM (${error.response?.status}) en ${fullUrl}: ${error.message}`);
        }
    }
    // Obtener Task por ID
    async getTask(taskId) {
        try {
            console.log(`📋 Obteniendo Task con ID: ${taskId}`);
            const task = await this.request('GET', `Task/${taskId}`);
            console.log(`✅ Task obtenida:`, task.name);
            return task;
        }
        catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`Task con ID ${taskId} no encontrada`);
            }
            throw new Error(`Error al obtener Task: ${error.message}`);
        }
    }
    // Obtener Contact por ID
    async getContact(contactId) {
        try {
            console.log(`👤 Obteniendo Contact con ID: ${contactId}`);
            const contact = await this.request('GET', `Contact/${contactId}`);
            console.log(`✅ Contact obtenido:`, contact.name);
            return contact;
        }
        catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`Contact con ID ${contactId} no encontrado`);
            }
            throw new Error(`Error al obtener Contact: ${error.message}`);
        }
    }
    // Método genérico para obtener cualquier entidad
    async getEntity(entityType, entityId) {
        try {
            console.log(`🔍 Obteniendo ${entityType} con ID: ${entityId}`);
            const entity = await this.request('GET', `${entityType}/${entityId}`);
            console.log(`✅ ${entityType} obtenido:`, entity.name || entity.id);
            return entity;
        }
        catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`${entityType} con ID ${entityId} no encontrado`);
            }
            throw new Error(`Error al obtener ${entityType}: ${error.message}`);
        }
    }
    /**
     * Obtiene una pagina de entidades usando searchParams, el formato oficial de
     * EspoCRM para combinar paginacion, seleccion de campos y filtros complejos.
     */
    async listEntitiesPage(entityType, params) {
        const searchParams = encodeURIComponent(JSON.stringify(params));
        const response = await this.request('GET', `${entityType}?searchParams=${searchParams}`);
        return {
            list: Array.isArray(response.list) ? response.list : [],
            total: typeof response.total === 'number' ? response.total : -1,
        };
    }
    // Método para buscar entidades con filtros
    // Método para buscar entidades con filtros
    async searchEntities(entityType, where) {
        try {
            console.log(`🔍 Buscando ${entityType} con filtros (JSON):`, JSON.stringify(where));
            const params = {
                maxSize: 200,
                sortBy: 'createdAt',
                asc: false,
            };
            // Construcción manual del query string para manejar arrays al estilo PHP/EspoCRM
            // EspoCRM espera format: where[0][type]=equals&where[0][attribute]=status...
            const queryParams = [];
            // 1. Añadir parámetros simples
            Object.keys(params).forEach(key => {
                queryParams.push(`${key}=${params[key]}`);
            });
            // 2. Serializar filtro 'where' recursivamente
            if (where) {
                const buildParams = (prefix, value) => {
                    if (Array.isArray(value)) {
                        value.forEach((v, i) => buildParams(`${prefix}[${i}]`, v));
                    }
                    else if (typeof value === 'object' && value !== null) {
                        Object.keys(value).forEach(k => buildParams(`${prefix}[${k}]`, value[k]));
                    }
                    else {
                        queryParams.push(`${prefix}=${encodeURIComponent(value)}`);
                    }
                };
                buildParams('where', where);
            }
            const queryString = queryParams.join('&');
            // No usamos URLSearchParams porque codifica los corchetes [] y EspoCRM a veces prefiere raw o específico
            // Pero axios normalmente codifica. Probemos construyendo la URL nosotros.
            // NOTA: axios.get(url) codificará la URL si tiene caracteres especiales.
            // queryParams ya tiene los valores codificados con encodeURIComponent arriba.
            // Los corchetes [ ] en las keys NO deben ser codificados para que PHP los lea nativamente como arrays,
            // AUNQUE el estándar dice que deberían. Muchos servidores PHP los aceptan sin codificar o decodifican.
            // Vamos a probar enviando la string construida.
            const fullEndpoint = `${entityType}?${queryString}`;
            console.log(`📡 URL Generada (Check params): ${fullEndpoint}`);
            const response = await this.request('GET', fullEndpoint);
            const list = response.list || [];
            console.log(`✅ Encontrados ${list.length} ${entityType}(s)`);
            return list;
        }
        catch (error) {
            console.error(`Error al buscar ${entityType}:`, error.message);
            throw new Error(`Error al buscar ${entityType}: ${error.message}`);
        }
    }
    // Obtener Quote por ID
    async getQuote(quoteId) {
        try {
            console.log(`📋 Obteniendo Quote con ID: ${quoteId}`);
            const quote = await this.request('GET', `Quote/${quoteId}`);
            console.log(`✅ Quote obtenida:`, quote.name);
            return quote;
        }
        catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`Quote con ID ${quoteId} no encontrada`);
            }
            throw new Error(`Error al obtener Quote: ${error.message}`);
        }
    }
    // Obtener Account por ID
    async getAccount(accountId) {
        try {
            console.log(`🏢 Obteniendo Account con ID: ${accountId}`);
            const account = await this.request('GET', `Account/${accountId}`);
            console.log(`✅ Account obtenido:`, account.name);
            return account;
        }
        catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`Account con ID ${accountId} no encontrado`);
            }
            throw new Error(`Error al obtener Account: ${error.message}`);
        }
    }
    // Crear una nueva entidad
    async createEntity(entityType, data) {
        try {
            console.log(`✨ Creando ${entityType} con datos:`, data);
            const response = await this.request('POST', entityType, data);
            console.log(`✅ ${entityType} creado exitosamente. ID: ${response.id}`);
            return response;
        }
        catch (error) {
            console.error(`Error al crear ${entityType}:`, error.message);
            throw new Error(`Error al crear ${entityType}: ${error.message}`);
        }
    }
    // Actualizar una entidad
    async updateEntity(entityType, entityId, data) {
        try {
            console.log(`📝 Actualizando ${entityType} ${entityId} con:`, data);
            await this.request('PUT', `${entityType}/${entityId}`, data);
            console.log(`✅ ${entityType} actualizado exitosamente`);
        }
        catch (error) {
            console.error(`Error al actualizar ${entityType}:`, error.message);
            throw new Error(`Error al actualizar ${entityType}: ${error.message}`);
        }
    }
    // Vincular entidades (Relationship Link)
    // POST /api/v1/{Entity}/{id}/link/{linkName}/{remoteId}
    async linkEntity(entityType, entityId, linkName, remoteId) {
        try {
            console.log(`🔗 Vinculando ${entityType} ${entityId} con ${linkName} ${remoteId}`);
            await this.request('POST', `${entityType}/${entityId}/link/${linkName}/${remoteId}`);
            console.log('✅ Vinculación exitosa');
            return true;
        }
        catch (error) {
            // 409 Conflict significa que ya están vinculados, lo cual es fine
            if (error.response?.status === 409) {
                console.log('⚠️ Ya estaban vinculados (409 Conflict)');
                return true;
            }
            console.error('❌ Error al vincular entidades:', error.message);
            // No lanzamos error para no romper el flujo principal
            return false;
        }
    }
    // Obtener archivo (stream)
    async getFile(fileId) {
        try {
            console.log(`📂 Obteniendo archivo con ID: ${fileId} usando EntryPoint`);
            // EspoCRM usa ?entryPoint=download en la raíz, no /api/v1/
            // Construir URL base sin /api/v1
            let baseUrl = env_1.env.espocrmBaseUrl;
            // Quitar /api/v1 si existe
            baseUrl = baseUrl.replace(/\/api\/v1\/?$/, '');
            // Asegurar que NO termine en /
            baseUrl = baseUrl.replace(/\/$/, '');
            const downloadUrl = `${baseUrl}/?entryPoint=download&id=${fileId}`;
            console.log(`📡 Descargando desde: ${downloadUrl}`);
            const response = await (0, axios_1.default)({
                method: 'GET',
                url: downloadUrl,
                responseType: 'stream',
                headers: {
                    'X-Api-Key': env_1.env.espocrmApiKey,
                }
            });
            return response;
        }
        catch (error) {
            console.error(`Error al obtener archivo ${fileId}:`, error.message);
            throw new Error(`Error al obtener archivo: ${error.message}`);
        }
    }
    // Obtener archivo como Buffer completo (más robusto para servir a Twilio)
    async getFileAsBuffer(fileId) {
        try {
            console.log(`📂 Obteniendo archivo (buffer) con ID: ${fileId} usando EntryPoint`);
            let baseUrl = env_1.env.espocrmBaseUrl;
            baseUrl = baseUrl.replace(/\/api\/v1\/?$/, '');
            baseUrl = baseUrl.replace(/\/$/, '');
            const downloadUrl = `${baseUrl}/?entryPoint=download&id=${fileId}`;
            console.log(`📡 Descargando (buffer) desde: ${downloadUrl}`);
            const response = await (0, axios_1.default)({
                method: 'GET',
                url: downloadUrl,
                responseType: 'arraybuffer',
                headers: {
                    'X-Api-Key': env_1.env.espocrmApiKey,
                },
                maxContentLength: Infinity,
                maxRedirects: 5,
                timeout: 30000, // 30s timeout para archivos grandes
            });
            console.log(`   ✅ Descarga buffer completa: ${response.data.byteLength} bytes`);
            return response;
        }
        catch (error) {
            console.error(`Error al obtener archivo (buffer) ${fileId}:`, error.message);
            throw new Error(`Error al obtener archivo: ${error.message}`);
        }
    }
    // Subir Adjunto (Nativo EspoCRM)
    // POST /api/v1/Attachment
    // EspoCRM requiere JSON con archivo en Base64 (NO multipart/form-data)
    // Docs: https://docs.espocrm.com/development/api/attachment/
    async uploadAttachment(buffer, fileName, mimeType, relatedType, relatedId, role = 'Attachment') {
        try {
            console.log(`📤 Subiendo Attachment a EspoCRM API: ${fileName} (${mimeType})`);
            console.log(`   - Buffer size: ${buffer.length} bytes`);
            // Convertir buffer a Base64 data URI (formato requerido por EspoCRM)
            const base64Content = buffer.toString('base64');
            const fileDataUri = `data:${mimeType};base64,${base64Content}`;
            // Construir payload JSON según documentación oficial de EspoCRM
            // Para campos tipo File: usar relatedType y relatedId
            // Docs: https://docs.espocrm.com/development/api/attachment/
            const payload = {
                name: fileName,
                type: mimeType,
                role: role,
                field: 'archivoAdjunto',
                file: fileDataUri,
            };
            // Para campos tipo File: usar relatedType y relatedId
            if (relatedType)
                payload.relatedType = relatedType;
            if (relatedId)
                payload.relatedId = relatedId;
            console.log(`   - Payload keys: ${Object.keys(payload).join(', ')}`);
            console.log(`   - Base64 size: ${base64Content.length} chars`);
            // Usar axios directamente para manejar payload grande y obtener error completo
            const url = `${env_1.env.espocrmBaseUrl}/api/v1/Attachment`;
            console.log(`📡 Requesting (Direct): POST ${url}`);
            const response = await axios_1.default.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': env_1.env.espocrmApiKey,
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
            console.log(`✅ Attachment subido exitosamente. ID: ${response.data.id}`);
            return response.data;
        }
        catch (error) {
            console.error('❌ Error subiendo Attachment (Status):', error.response?.status);
            console.error('❌ Error subiendo Attachment (Headers):', JSON.stringify(error.response?.headers, null, 2));
            console.error('❌ Error subiendo Attachment (Data):', JSON.stringify(error.response?.data, null, 2));
            throw new Error(`Error subiendo Attachment: ${error.message}`);
        }
    }
}
exports.EspoCRMClient = EspoCRMClient;
