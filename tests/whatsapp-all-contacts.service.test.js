const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WhatsappAllContactsService,
  createInitialAllContactsProgress,
} = require('../dist/services/whatsapp-all-contacts.service');
const {
  WhatsappBulkJobManager,
} = require('../dist/services/whatsapp-bulk-job.service');

test('envia name e imagen a todos los Contact con phone, paginando y sin duplicados', async () => {
  const listCalls = [];
  const sentMessages = [];
  const createdMessages = [];

  const espoCRMClient = {
    async getEntity() {
      return {
        id: 'template-1',
        name: 'anuncios_netcare',
        whatsappTemplateSID: 'HX_TEST',
        archivoAdjuntoId: 'image-1',
      };
    },
    async listEntitiesPage(_entityType, params) {
      listCalls.push(params);

      if (params.offset === 0) {
        return {
          total: 3,
          list: [
            { id: 'contact-1', name: 'Ana', phone: '55 1234 5678' },
            { id: 'contact-2', name: 'Luis', phone: '+52 55 1234 5678' },
          ],
        };
      }

      return {
        total: 3,
        list: [
          { id: 'contact-3', name: 'Telefono invalido', phone: '123' },
        ],
      };
    },
    async searchEntities() {
      return [];
    },
    async createEntity(_entityType, payload) {
      createdMessages.push(payload);
      return { id: 'message-1' };
    },
    async updateEntity() {},
  };

  const service = new WhatsappAllContactsService({
    espoCRMClient,
    delayMs: 0,
    pageSize: 2,
    async sendTemplateMessage(payload) {
      sentMessages.push(payload);
      return { sid: 'SM_TEST' };
    },
  });

  const result = await service.handleAllContactsSend('template-1');

  assert.equal(listCalls.length, 2);
  assert.equal(listCalls[0].select, 'id,name,phone');
  assert.deepEqual(listCalls[0].where, [
    { type: 'isNotNull', attribute: 'phone' },
  ]);
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0], {
    phone: '+525512345678',
    contentSid: 'HX_TEST',
    contentVariables: {
      '1': 'Ana',
      '2': 'http://localhost:3000/api/files/image-1',
    },
  });
  assert.equal(createdMessages[0].contactId, 'contact-1');
  assert.equal(result.totalContacts, 3);
  assert.equal(result.processed, 3);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skippedDuplicatePhone, 1);
});

test('detiene el trabajo si el template no tiene Archivo Adjunto para {{2}}', async () => {
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
      async listEntitiesPage() {
        listedContacts = true;
        return { total: 0, list: [] };
      },
      async searchEntities() { return []; },
      async createEntity() { return {}; },
      async updateEntity() {},
    },
    async sendTemplateMessage() {
      throw new Error('No se debe enviar');
    },
  });

  await assert.rejects(
    () => service.handleAllContactsSend('template-2'),
    /no tiene Archivo Adjunto/,
  );
  assert.equal(listedContacts, false);
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
