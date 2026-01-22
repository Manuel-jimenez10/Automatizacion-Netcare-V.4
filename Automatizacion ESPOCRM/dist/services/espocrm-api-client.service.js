"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
    request(method, endpoint, data) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            try {
                // Asegurar que no haya doble slash //
                const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
                const dbgUrl = `/api/v1/${cleanEndpoint}`; // Leading slash ensures proper URL joining
                console.log(`📡 Requesting: ${method} ${this.client.defaults.baseURL}${dbgUrl}`);
                const response = yield this.client.request({
                    method,
                    url: dbgUrl,
                    data,
                });
                return response.data;
            }
            catch (error) {
                // Manejo de errores
                console.error('EspoCRM API Error:', (_a = error.response) === null || _a === void 0 ? void 0 : _a.status, (_b = error.response) === null || _b === void 0 ? void 0 : _b.data);
                // Incluir URL en el error para debugging
                const fullUrl = `${this.client.defaults.baseURL}/api/v1/${endpoint}`;
                throw new Error(`Error EspoCRM (${(_c = error.response) === null || _c === void 0 ? void 0 : _c.status}) en ${fullUrl}: ${error.message}`);
            }
        });
    }
    // Obtener Task por ID
    getTask(taskId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                console.log(`📋 Obteniendo Task con ID: ${taskId}`);
                const task = yield this.request('GET', `Task/${taskId}`);
                console.log(`✅ Task obtenida:`, task.name);
                return task;
            }
            catch (error) {
                if (((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 404) {
                    throw new Error(`Task con ID ${taskId} no encontrada`);
                }
                throw new Error(`Error al obtener Task: ${error.message}`);
            }
        });
    }
    // Obtener Contact por ID
    getContact(contactId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                console.log(`👤 Obteniendo Contact con ID: ${contactId}`);
                const contact = yield this.request('GET', `Contact/${contactId}`);
                console.log(`✅ Contact obtenido:`, contact.name);
                return contact;
            }
            catch (error) {
                if (((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 404) {
                    throw new Error(`Contact con ID ${contactId} no encontrado`);
                }
                throw new Error(`Error al obtener Contact: ${error.message}`);
            }
        });
    }
    // Método genérico para obtener cualquier entidad
    getEntity(entityType, entityId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                console.log(`🔍 Obteniendo ${entityType} con ID: ${entityId}`);
                const entity = yield this.request('GET', `${entityType}/${entityId}`);
                console.log(`✅ ${entityType} obtenido:`, entity.name || entity.id);
                return entity;
            }
            catch (error) {
                if (((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 404) {
                    throw new Error(`${entityType} con ID ${entityId} no encontrado`);
                }
                throw new Error(`Error al obtener ${entityType}: ${error.message}`);
            }
        });
    }
    // Método para buscar entidades con filtros
    // Método para buscar entidades con filtros
    searchEntities(entityType, where) {
        return __awaiter(this, void 0, void 0, function* () {
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
                const response = yield this.request('GET', fullEndpoint);
                const list = response.list || [];
                console.log(`✅ Encontrados ${list.length} ${entityType}(s)`);
                return list;
            }
            catch (error) {
                console.error(`Error al buscar ${entityType}:`, error.message);
                throw new Error(`Error al buscar ${entityType}: ${error.message}`);
            }
        });
    }
    // Obtener Quote por ID
    getQuote(quoteId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                console.log(`📋 Obteniendo Quote con ID: ${quoteId}`);
                const quote = yield this.request('GET', `Quote/${quoteId}`);
                console.log(`✅ Quote obtenida:`, quote.name);
                return quote;
            }
            catch (error) {
                if (((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 404) {
                    throw new Error(`Quote con ID ${quoteId} no encontrada`);
                }
                throw new Error(`Error al obtener Quote: ${error.message}`);
            }
        });
    }
    // Obtener Account por ID
    getAccount(accountId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                console.log(`🏢 Obteniendo Account con ID: ${accountId}`);
                const account = yield this.request('GET', `Account/${accountId}`);
                console.log(`✅ Account obtenido:`, account.name);
                return account;
            }
            catch (error) {
                if (((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 404) {
                    throw new Error(`Account con ID ${accountId} no encontrado`);
                }
                throw new Error(`Error al obtener Account: ${error.message}`);
            }
        });
    }
    // Crear una nueva entidad
    createEntity(entityType, data) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`✨ Creando ${entityType} con datos:`, data);
                const response = yield this.request('POST', entityType, data);
                console.log(`✅ ${entityType} creado exitosamente. ID: ${response.id}`);
                return response;
            }
            catch (error) {
                console.error(`Error al crear ${entityType}:`, error.message);
                throw new Error(`Error al crear ${entityType}: ${error.message}`);
            }
        });
    }
    // Actualizar una entidad
    updateEntity(entityType, entityId, data) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`📝 Actualizando ${entityType} ${entityId} con:`, data);
                yield this.request('PUT', `${entityType}/${entityId}`, data);
                console.log(`✅ ${entityType} actualizado exitosamente`);
            }
            catch (error) {
                console.error(`Error al actualizar ${entityType}:`, error.message);
                throw new Error(`Error al actualizar ${entityType}: ${error.message}`);
            }
        });
    }
    // Vincular entidades (Relationship Link)
    // POST /api/v1/{Entity}/{id}/link/{linkName}/{remoteId}
    linkEntity(entityType, entityId, linkName, remoteId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                console.log(`🔗 Vinculando ${entityType} ${entityId} con ${linkName} ${remoteId}`);
                yield this.request('POST', `${entityType}/${entityId}/link/${linkName}/${remoteId}`);
                console.log('✅ Vinculación exitosa');
                return true;
            }
            catch (error) {
                // 409 Conflict significa que ya están vinculados, lo cual es fine
                if (((_a = error.response) === null || _a === void 0 ? void 0 : _a.status) === 409) {
                    console.log('⚠️ Ya estaban vinculados (409 Conflict)');
                    return true;
                }
                console.error('❌ Error al vincular entidades:', error.message);
                // No lanzamos error para no romper el flujo principal
                return false;
            }
        });
    }
    // Obtener archivo (stream)
    getFile(fileId) {
        return __awaiter(this, void 0, void 0, function* () {
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
                const response = yield (0, axios_1.default)({
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
        });
    }
}
exports.EspoCRMClient = EspoCRMClient;
