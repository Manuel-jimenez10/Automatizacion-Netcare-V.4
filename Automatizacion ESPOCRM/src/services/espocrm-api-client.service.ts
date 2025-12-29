import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import { EspoCRMTask, EspoCRMContact, EspoCRMQuote, EspoCRMAccount } from '../interfaces/interfaces';

export class EspoCRMClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.espocrmBaseUrl,
      headers: {
        'X-Api-Key': env.espocrmApiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  // Método genérico para hacer requests
  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any
  ) {
    try {
      // Asegurar que no haya doble slash //
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
      const dbgUrl = `api/v1/${cleanEndpoint}`; // Removed leading slash so axios joins correctly with baseURL
      console.log(`📡 Requesting: ${method} ${this.client.defaults.baseURL}${dbgUrl}`);
      
      const response = await this.client.request({
        method,
        url: dbgUrl,
        data,
      });
      return response.data;
    } catch (error: any) {
      // Manejo de errores
      console.error('EspoCRM API Error:', error.response?.status, error.response?.data);
      // Incluir URL en el error para debugging
      const fullUrl = `${this.client.defaults.baseURL}/api/v1/${endpoint}`;
      throw new Error(`Error EspoCRM (${error.response?.status}) en ${fullUrl}: ${error.message}`);
    }
  }

  // Obtener Task por ID
  async getTask(taskId: string): Promise<EspoCRMTask> {
    try {
      console.log(`📋 Obteniendo Task con ID: ${taskId}`);
      const task = await this.request('GET', `Task/${taskId}`);
      console.log(`✅ Task obtenida:`, task.name);
      return task as EspoCRMTask;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Task con ID ${taskId} no encontrada`);
      }
      throw new Error(`Error al obtener Task: ${error.message}`);
    }
  }

  // Obtener Contact por ID
  async getContact(contactId: string): Promise<EspoCRMContact> {
    try {
      console.log(`👤 Obteniendo Contact con ID: ${contactId}`);
      const contact = await this.request('GET', `Contact/${contactId}`);
      console.log(`✅ Contact obtenido:`, contact.name);
      return contact as EspoCRMContact;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Contact con ID ${contactId} no encontrado`);
      }
      throw new Error(`Error al obtener Contact: ${error.message}`);
    }
  }

  // Método genérico para obtener cualquier entidad
  async getEntity(entityType: string, entityId: string): Promise<any> {
    try {
      console.log(`🔍 Obteniendo ${entityType} con ID: ${entityId}`);
      const entity = await this.request('GET', `${entityType}/${entityId}`);
      console.log(`✅ ${entityType} obtenido:`, entity.name || entity.id);
      return entity;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`${entityType} con ID ${entityId} no encontrado`);
      }
      throw new Error(`Error al obtener ${entityType}: ${error.message}`);
    }
  }

  // Método para buscar entidades con filtros
  // Método para buscar entidades con filtros
  async searchEntities(entityType: string, where?: any): Promise<any[]> {
    try {
      console.log(`🔍 Buscando ${entityType} con filtros (JSON):`, JSON.stringify(where));
      
      const params: any = {
        maxSize: 200,
        sortBy: 'createdAt',
        asc: false,
      };

      // Construcción manual del query string para manejar arrays al estilo PHP/EspoCRM
      // EspoCRM espera format: where[0][type]=equals&where[0][attribute]=status...
      const queryParams: string[] = [];

      // 1. Añadir parámetros simples
      Object.keys(params).forEach(key => {
        queryParams.push(`${key}=${params[key]}`);
      });

      // 2. Serializar filtro 'where' recursivamente
      if (where) {
        const buildParams = (prefix: string, value: any) => {
          if (Array.isArray(value)) {
            value.forEach((v, i) => buildParams(`${prefix}[${i}]`, v));
          } else if (typeof value === 'object' && value !== null) {
            Object.keys(value).forEach(k => buildParams(`${prefix}[${k}]`, value[k]));
          } else {
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
    } catch (error: any) {
      console.error(`Error al buscar ${entityType}:`, error.message);
      throw new Error(`Error al buscar ${entityType}: ${error.message}`);
    }
  }

  // Obtener Quote por ID
  async getQuote(quoteId: string): Promise<EspoCRMQuote> {
    try {
      console.log(`📋 Obteniendo Quote con ID: ${quoteId}`);
      const quote = await this.request('GET', `Quote/${quoteId}`);
      console.log(`✅ Quote obtenida:`, quote.name);
      return quote as EspoCRMQuote;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Quote con ID ${quoteId} no encontrada`);
      }
      throw new Error(`Error al obtener Quote: ${error.message}`);
    }
  }

  // Obtener Account por ID
  async getAccount(accountId: string): Promise<EspoCRMAccount> {
    try {
      console.log(`🏢 Obteniendo Account con ID: ${accountId}`);
      const account = await this.request('GET', `Account/${accountId}`);
      console.log(`✅ Account obtenido:`, account.name);
      return account as EspoCRMAccount;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Account con ID ${accountId} no encontrado`);
      }
      throw new Error(`Error al obtener Account: ${error.message}`);
    }
  }

  // Actualizar una entidad
  async updateEntity(entityType: string, entityId: string, data: any): Promise<void> {
    try {
      console.log(`📝 Actualizando ${entityType} ${entityId} con:`, data);
      await this.request('PUT', `${entityType}/${entityId}`, data);
      console.log(`✅ ${entityType} actualizado exitosamente`);
    } catch (error: any) {
      console.error(`Error al actualizar ${entityType}:`, error.message);
      throw new Error(`Error al actualizar ${entityType}: ${error.message}`);
    }
  }

  // Obtener archivo (stream)
  async getFile(fileId: string): Promise<any> {
    try {
      console.log(`📂 Obteniendo archivo con ID: ${fileId} usando EntryPoint`);
      
      // Construir URL completa porque entryPoint está en la raíz, no en /api/v1/
      // La baseURL actual es ".../api/v1/", así que necesitamos "salir" de ahí o usar una nueva instancia
      // O simplemente usar axios con la URL absoluta base
      
      // Limpiar baseURL para quitar /api/v1 si existe
      const baseUrl = env.espocrmBaseUrl.replace(/\/api\/v1\/?$/, '');
      const downloadUrl = `${baseUrl}/?entryPoint=download&id=${fileId}`;
      
      console.log(`📡 Descargando desde: ${downloadUrl}`);

      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        headers: {
          'X-Api-Key': env.espocrmApiKey, // Se envía la API Key también al entryPoint
        }
      });
      return response;
    } catch (error: any) {
      console.error(`Error al obtener archivo ${fileId}:`, error.message);
      throw new Error(`Error al obtener archivo: ${error.message}`);
    }
  }
}

