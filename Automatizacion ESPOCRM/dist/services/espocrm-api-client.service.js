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
                const dbgUrl = `api/v1/${cleanEndpoint}`; // Removed leading slash so axios joins correctly with baseURL
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
    searchEntities(entityType, where) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                console.log(`🔍 Buscando ${entityType} con filtros:`, JSON.stringify(where));
                const params = {
                    maxSize: 200, // Límite de resultados
                    sortBy: 'createdAt', // Ordenar por fecha de creación
                    asc: false, // Descendente (más recientes primero)
                };
                if (where) {
                    params.where = where;
                }
                const response = yield this.request('GET', `${entityType}?${new URLSearchParams(Object.assign(Object.assign({}, params), { where: JSON.stringify(params.where || []) }))}`);
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
}
exports.EspoCRMClient = EspoCRMClient;
