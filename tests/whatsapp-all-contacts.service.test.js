const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');

const {
  WhatsappAllContactsService,
  createInitialAllContactsProgress,
} = require('../dist/services/whatsapp-all-contacts.service');
const {
  WhatsappBulkJobManager,
} = require('../dist/services/whatsapp-bulk-job.service');

test('envia name al template multimedia estatico, con validacion y sin duplicados', async () => {
  const reportCalls = [];
  const sentMessages = [];
  const createdMessages = [];
  const updatedConversations = [];

  const espoCRMClient = {
    async getEntity() {
      return {
        id: 'template-1',
        name: 'anuncios_netcare',
        whatsappTemplateSID: 'HX_TEST',
        archivoAdjuntoId: 'image-1',
        contentMessageTemplate: '<p>Hola, nombre. Vista previa incorrecta.</p>',
      };
    },
    async request() { throw new Error('El loader de prueba evita la API real'); },
    async searchEntities() {
      return [{ id: 'conversation-1' }];
    },
    async createEntity(_entityType, payload) {
      createdMessages.push(payload);
      return { id: 'message-1' };
    },
    async updateEntity(_entityType, _entityId, payload) {
      updatedConversations.push(payload);
    },
  };

  const service = new WhatsappAllContactsService({
    espoCRMClient,
    delayMs: 0,
    async reportContactsLoader(reportId) {
      reportCalls.push(reportId);
      return [
        { id: 'contact-1', name: 'Ana', phone: '55 1234 5678' },
        { id: 'contact-2', name: 'Luis', phone: '+52 55 1234 5678' },
        { id: 'contact-3', name: 'Telefono invalido', phone: '123' },
      ];
    },
    async sendTemplateMessage(payload) {
      sentMessages.push(payload);
      return {
        sid: 'SM_TEST',
        body: 'Hola, Ana. Este es el mensaje completo que recibio el cliente.',
      };
    },
  });

  const result = await service.handleAllContactsSend('template-1');

  assert.deepEqual(reportCalls, ['69c1bf528b8fb6477']);
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0], {
    phone: '+525512345678',
    contentSid: 'HX_TEST',
    contentVariables: {
      '1': 'Ana',
    },
  });
  assert.equal(createdMessages[0].contactId, 'contact-1');
  assert.equal(
    createdMessages[0].description,
    'Hola, Ana. Este es el mensaje completo que recibio el cliente.',
  );
  assert.equal(
    updatedConversations[0].description,
    'Hola, Ana. Este es el mensaje completo que recibio el cliente.',
  );
  assert.doesNotMatch(createdMessages[0].description, /Vista previa/);
  assert.equal(result.totalContacts, 3);
  assert.equal(result.processed, 3);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skippedDuplicatePhone, 1);
});

test('permite el envio sin Archivo Adjunto porque la imagen es estatica en Twilio', async () => {
  let listedContacts = false;
  const service = new WhatsappAllContactsService({
    delayMs: 0,
    espoCRMClient: {
      async getEntity() {
        return {
          id: 'template-2',
          name: 'sin_imagen',
          whatsappTemplateSID: 'HX_TEST',
        };
      },
      async request() { return {}; },
      async searchEntities() { return []; },
      async createEntity() { return {}; },
      async updateEntity() {},
    },
    async reportContactsLoader() {
      listedContacts = true;
      return [];
    },
    async sendTemplateMessage() {
      throw new Error('No se debe enviar');
    },
  });

  const result = await service.handleAllContactsSend('template-2');
  assert.equal(listedContacts, true);
  assert.equal(result.totalContacts, 0);
});

test('exporta el reporte funcional y reconoce columnas name y phone', async () => {
  const originalAxiosGet = axios.get;
  const apiRequests = [];
  const sentMessages = [];

  axios.get = async () => ({
    data: Buffer.from(
      'id;name;phone\r\ncontact-4;Maria;5511112222\r\n',
      'utf-8',
    ),
  });

  try {
    const service = new WhatsappAllContactsService({
      delayMs: 0,
      espoCRMClient: {
        async getEntity() {
          return {
            id: 'template-4',
            name: 'anuncios_netcare',
            whatsappTemplateSID: 'HX_REPORT',
            archivoAdjuntoId: 'image-4',
          };
        },
        async request(method, endpoint, data) {
          apiRequests.push({ method, endpoint, data });
          return { id: 'csv-attachment-1' };
        },
        async searchEntities() { return []; },
        async createEntity() { return { id: 'message-4' }; },
        async updateEntity() {},
      },
      async sendTemplateMessage(payload) {
        sentMessages.push(payload);
        return { sid: 'SM_REPORT', body: 'Hola, Maria. Mensaje final.' };
      },
    });

    const result = await service.handleAllContactsSend('template-4');

    assert.deepEqual(apiRequests, [{
      method: 'POST',
      endpoint: 'Report/action/exportList',
      data: { id: '69c1bf528b8fb6477', format: 'csv' },
    }]);
    assert.equal(sentMessages[0].contentVariables['1'], 'Maria');
    assert.equal(sentMessages[0].contentVariables['2'], undefined);
    assert.equal(sentMessages[0].phone, '+525511112222');
    assert.equal(result.sent, 1);
  } finally {
    axios.get = originalAxiosGet;
  }
});

test('la cola responde de inmediato, evita trabajos duplicados y conserva progreso', async () => {
  const completedProgress = {
    ...createInitialAllContactsProgress(),
    totalContacts: 1,
    processed: 1,
    sent: 1,
  };

  const manager = new WhatsappBulkJobManager(() => ({
    async handleAllContactsSend(_templateId, onProgress) {
      onProgress(completedProgress);
      return completedProgress;
    },
  }));

  const first = manager.enqueue('template-3');
  const duplicate = manager.enqueue('template-3');

  assert.equal(first.reused, false);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.job.id, first.job.id);

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  const completed = manager.getJob(first.job.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress.sent, 1);
});
