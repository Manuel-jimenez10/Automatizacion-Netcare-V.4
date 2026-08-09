const assert = require('node:assert/strict');
const test = require('node:test');

process.env.QUOTE_FOLLOWUP_SID = 'HX_FOLLOWUP_TEST';
process.env.QUOTE_FOLLOWUP_EXHAUSTED_SID = 'HX_EXHAUSTED_TEST';

const { QuoteFollowUpService } = require('../dist/services/quote-followup.service');
const { env } = require('../dist/config/env');

const COUNTER = env.quoteFollowUpCounterField; // 'seguimientoCotizacion'
const HOY = new Date();
const haceDias = d => new Date(HOY.getTime() - d * 86400000).toISOString().split('T')[0];

/**
 * CRM simulado. `quotes` es el estado real: el PUT lo muta, igual que EspoCRM.
 * Por defecto acepta el campo contador; con `ignoraContador: true` simula el
 * caso en que el nombre del campo no existe (EspoCRM responde 200 y no escribe).
 */
const buildCrm = (quotes, options = {}) => {
  const state = new Map(quotes.map(q => [q.id, { ...q }]));
  const created = [];
  const inboundMessages = options.inboundMessages || [];

  return {
    state,
    created,
    async searchEntitiesPaged(entityType, _where, opts = {}) {
      if (entityType !== 'Quote') return { list: [], total: 0 };
      const list = [...state.values()].filter(q => q.status === 'Presented');
      const offset = opts.offset || 0;
      return { list: list.slice(offset, offset + (opts.maxSize || 200)), total: list.length };
    },
    async searchEntities(entityType) {
      if (entityType === 'WhatsappMessage') return inboundMessages;
      return [];
    },
    async getEntity(entityType, id) {
      if (entityType !== 'Quote') throw new Error(`getEntity inesperado: ${entityType}`);
      const quote = state.get(id);
      if (!quote) throw new Error('no existe');

      const copy = { ...quote };
      // EspoCRM no devuelve la clave si el campo no existe en la entidad.
      if (options.ignoraContador) delete copy[COUNTER];
      return copy;
    },
    async getContact(contactId) {
      return {
        id: contactId,
        name: options.contactName || 'Ana Perez',
        phoneNumber: options.contactPhone || '+525512345678',
      };
    },
    async updateEntity(entityType, id, payload) {
      const quote = state.get(id);
      const applied = { ...payload };

      // EspoCRM ignora en silencio los atributos que no existen.
      if (options.ignoraContador) delete applied[COUNTER];

      Object.assign(quote, applied);
      return { ...quote };
    },
    async createEntity(entityType, payload) {
      created.push({ entityType, payload });
      return { id: 'msg-1' };
    },
  };
};

const buildService = (crm, overrides = {}) => {
  const sent = [];
  const adminAlerts = [];

  const service = new QuoteFollowUpService({
    espoCRMClient: crm,
    async sendTemplate(payload) {
      sent.push(payload);
      return { sid: `SM_Q_${sent.length}`, body: 'Texto renderizado' };
    },
    async lookupLastInbound() {
      return overrides.lastInbound !== undefined ? overrides.lastInbound : null;
    },
    async notifyExhausted(payload) {
      adminAlerts.push(payload);
      return { notified: true };
    },
    ...overrides.deps,
  });

  return { service, sent, adminAlerts };
};

/** Sin pausas ni tope, para que los tests sean rapidos y deterministas. */
const withConfig = async (patch, fn) => {
  const original = {};
  for (const key of Object.keys(patch)) original[key] = env[key];
  Object.assign(env, patch);
  try {
    return await fn();
  } finally {
    Object.assign(env, original);
  }
};

const runService = (crm, overrides) =>
  withConfig({ quoteFollowUpDelayMs: 0 }, async () => {
    const built = buildService(crm, overrides);
    const result = await built.service.processQuoteFollowUps();
    return { ...built, result };
  });

const quoteBase = extra => ({
  id: 'q1',
  name: 'COT-001',
  status: 'Presented',
  billingContactId: 'contact-1',
  datePresented: haceDias(30),
  createdAt: haceDias(40),
  // EspoCRM devuelve la clave presente con null cuando el entero esta vacio.
  [COUNTER]: null,
  ...extra,
});

test('primer seguimiento: contador vacio y 7+ dias -> envia y pone el contador a 1', async () => {
  const crm = buildCrm([quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(10) })]);
  const { sent, adminAlerts, result } = await runService(crm);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].contentSid, 'HX_FOLLOWUP_TEST');
  assert.deepEqual(sent[0].contentVariables, { 1: 'Ana Perez', 2: 'COT-001' });
  assert.equal(sent[0].phone, '+525512345678');

  assert.equal(crm.state.get('q1')[COUNTER], 1);
  assert.equal(adminAlerts.length, 0, 'el aviso al admin es solo del ultimo seguimiento');
  assert.equal(result.sent, 1);
});

test('segundo seguimiento: contador 1 sin respuesta -> envia, pone 2 y avisa al administrador', async () => {
  const crm = buildCrm([
    quoteBase({ [COUNTER]: 1, cotizacinEnviadaPorWhatsapp: haceDias(8) }),
  ]);
  const { sent, adminAlerts } = await runService(crm);

  assert.equal(sent.length, 1);
  assert.equal(crm.state.get('q1')[COUNTER], 2);

  assert.equal(adminAlerts.length, 1);
  assert.deepEqual(adminAlerts[0], {
    quoteName: 'COT-001',
    clientPhone: '+525512345678',
  });
});

test('contador ya en 2: no se vuelve a enviar nunca', async () => {
  const crm = buildCrm([
    quoteBase({ [COUNTER]: 2, cotizacinEnviadaPorWhatsapp: haceDias(90) }),
  ]);
  const { sent, result } = await runService(crm);

  assert.equal(sent.length, 0);
  assert.equal(result.details[0].outcome, 'exhausted');
});

test('el cliente respondio segun el CRM: se cierra el seguimiento sin enviar', async () => {
  const crm = buildCrm(
    [quoteBase({ [COUNTER]: 1, cotizacinEnviadaPorWhatsapp: haceDias(8) })],
    {
      inboundMessages: [
        { id: 'in-1', type: 'In', name: '+525512345678', contactId: 'contact-1' },
      ],
    },
  );
  const { sent, adminAlerts, result } = await runService(crm);

  assert.equal(sent.length, 0);
  assert.equal(adminAlerts.length, 0);
  assert.equal(result.stoppedByReply, 1);
  // Se marca como agotada para no volver a evaluarla cada semana.
  assert.equal(crm.state.get('q1')[COUNTER], 2);
});

test('el cliente respondio segun Twilio (aunque el CRM no lo tenga): tampoco se envia', async () => {
  const crm = buildCrm([
    quoteBase({ [COUNTER]: 1, cotizacinEnviadaPorWhatsapp: haceDias(8) }),
  ]);
  const { sent, result } = await runService(crm, { lastInbound: new Date() });

  assert.equal(sent.length, 0);
  assert.equal(result.stoppedByReply, 1);
});

test('el numero entrante de Mexico llega con el 1 y aun asi se reconoce la respuesta', async () => {
  const crm = buildCrm(
    [quoteBase({ [COUNTER]: 1, cotizacinEnviadaPorWhatsapp: haceDias(8) })],
    {
      // El saliente se guardo como +525512345678 y el entrante llega con el "1".
      inboundMessages: [{ id: 'in-1', type: 'In', name: '+5215512345678' }],
    },
  );
  const { sent, result } = await runService(crm);

  assert.equal(sent.length, 0);
  assert.equal(result.stoppedByReply, 1);
});

test('menos de 7 dias: no se envia', async () => {
  const crm = buildCrm([
    quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(3) }),
  ]);
  const { sent, result } = await runService(crm);

  assert.equal(sent.length, 0);
  assert.equal(result.details[0].outcome, 'waiting');
});

test('si el campo contador no existe, se ABORTA la corrida sin enviar nada', async () => {
  const crm = buildCrm(
    [
      quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(10) }),
      quoteBase({ id: 'q2', name: 'COT-002', cotizacinEnviadaPorWhatsapp: haceDias(10) }),
    ],
    { ignoraContador: true },
  );

  const { service, sent } = buildService(crm);

  await assert.rejects(() => service.processQuoteFollowUps(), /no existe en Quote/);
  assert.equal(sent.length, 0, 'no debe enviarse nada si el contador no se puede escribir');
});

test('el intento se reserva ANTES de enviar: si Twilio falla no se reintenta manana', async () => {
  const crm = buildCrm([quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(10) })]);

  const result = await withConfig({ quoteFollowUpDelayMs: 0 }, async () => {
    const service = new QuoteFollowUpService({
      espoCRMClient: crm,
      async sendTemplate() { throw new Error('Twilio caido'); },
      async lookupLastInbound() { return null; },
      async notifyExhausted() { return {}; },
    });
    return service.processQuoteFollowUps();
  });

  assert.equal(result.errors, 1);
  // El contador YA subio: el mensaje pudo haber salido, no se arriesga a repetirlo.
  assert.equal(crm.state.get('q1')[COUNTER], 1);
  assert.equal(crm.state.get('q1').cotizacinEnviadaPorWhatsapp, new Date().toISOString().split('T')[0]);
});

test('el tope por corrida difiere el resto al dia siguiente', async () => {
  // Clientes DISTINTOS, para aislar el tope de corrida del limite por destinatario.
  const quotes = Array.from({ length: 5 }, (_, i) =>
    quoteBase({
      id: `q${i}`,
      name: `COT-00${i}`,
      billingContactId: `contact-${i}`,
      cotizacinEnviadaPorWhatsapp: haceDias(10),
    }),
  );
  const crm = buildCrm(quotes);
  crm.getContact = async contactId => ({
    id: contactId,
    name: `Cliente ${contactId}`,
    phoneNumber: `+52551234000${contactId.replace('contact-', '')}`,
  });

  const built = buildService(crm);
  const result = await withConfig(
    { quoteFollowUpDelayMs: 0, quoteFollowUpMaxPerRun: 2 },
    () => built.service.processQuoteFollowUps(),
  );

  assert.equal(built.sent.length, 2);
  assert.equal(result.deferred, 3);
});

test('si la cotizacion sale de Presented mientras corre el proceso, no se le envia', async () => {
  const crm = buildCrm([quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(10) })]);

  // Simula el cambio de estado entre el listado y la relectura por ID.
  const originalGet = crm.getEntity.bind(crm);
  crm.getEntity = async (entityType, id) => {
    const quote = await originalGet(entityType, id);
    return { ...quote, status: 'Closed Won' };
  };

  const { sent, result } = await runService(crm);

  assert.equal(sent.length, 0);
  assert.equal(result.details[0].outcome, 'not_presented');
});

test('modo simulacion: calcula pero no envia ni toca el CRM', async () => {
  const crm = buildCrm([quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(10) })]);
  const built = buildService(crm);

  const result = await withConfig({ quoteFollowUpDelayMs: 0 }, () =>
    built.service.processQuoteFollowUps({ dryRun: true }),
  );

  assert.equal(built.sent.length, 0);
  assert.equal(result.sent, 1, 'cuenta lo que se habria enviado');
  assert.equal(result.details[0].outcome, 'would_send');
  assert.equal(crm.state.get('q1')[COUNTER], null, 'no se escribe nada en dry-run');
});

test('la respuesta del cliente corta TAMBIEN antes del primer seguimiento', async () => {
  const crm = buildCrm(
    // Contador vacio: nunca se le hizo seguimiento, pero ya contesto al
    // mensaje de "cotizacion presentada".
    [quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(10) })],
    { inboundMessages: [{ id: 'in-1', type: 'In', name: '+525512345678' }] },
  );
  const { sent, result } = await runService(crm);

  assert.equal(sent.length, 0);
  assert.equal(result.stoppedByReply, 1);
  assert.equal(result.details[0].outcome, 'stopped_by_reply');
});

test('si NINGUNA fuente puede comprobar la respuesta, no se envia y se reintenta manana', async () => {
  const crm = buildCrm([quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(10) })]);
  crm.searchEntities = async () => { throw new Error('EspoCRM 520'); };

  const result = await withConfig({ quoteFollowUpDelayMs: 0 }, async () => {
    const service = new QuoteFollowUpService({
      espoCRMClient: crm,
      async sendTemplate() { throw new Error('no debe enviarse'); },
      async lookupLastInbound() { throw new Error('Twilio 429'); },
      async notifyExhausted() { return {}; },
    });
    return service.processQuoteFollowUps();
  });

  assert.equal(result.errors, 1);
  assert.match(result.details[0].reason, /no se pudo comprobar/);
  // El contador NO se toca: manana se reintenta con normalidad.
  assert.equal(crm.state.get('q1')[COUNTER], null);
});

test('un opt-out del cliente (21610) cierra el ciclo: no habra segundo seguimiento', async () => {
  const crm = buildCrm([quoteBase({ cotizacinEnviadaPorWhatsapp: haceDias(10) })]);

  const built = buildService(crm, {
    deps: {
      async sendTemplate() {
        const error = new Error('The message From/To pair violates a blacklist rule');
        error.code = 21610;
        throw error;
      },
    },
  });

  const result = await withConfig({ quoteFollowUpDelayMs: 0 }, () =>
    built.service.processQuoteFollowUps(),
  );

  assert.equal(result.errors, 1);
  assert.equal(crm.state.get('q1')[COUNTER], 2, 'el ciclo queda cerrado, no solo en 1');
});

test('un mismo cliente con varias cotizaciones recibe UN solo seguimiento por corrida', async () => {
  const crm = buildCrm([
    quoteBase({ id: 'q1', name: 'COT-001', cotizacinEnviadaPorWhatsapp: haceDias(10) }),
    quoteBase({ id: 'q2', name: 'COT-002', cotizacinEnviadaPorWhatsapp: haceDias(10) }),
    quoteBase({ id: 'q3', name: 'COT-003', cotizacinEnviadaPorWhatsapp: haceDias(10) }),
  ]);
  const { sent, result } = await runService(crm);

  assert.equal(sent.length, 1, 'las 3 cotizaciones son del mismo telefono');
  assert.equal(result.deferred, 2);
});

test('el aviso al administrador solo se cuenta si se entrego de verdad', async () => {
  const crm = buildCrm([
    quoteBase({ [COUNTER]: 1, cotizacinEnviadaPorWhatsapp: haceDias(8) }),
  ]);

  const built = buildService(crm, {
    deps: {
      async notifyExhausted() {
        return { notified: false, reason: 'hourly_cap' };
      },
    },
  });

  const result = await withConfig({ quoteFollowUpDelayMs: 0 }, () =>
    built.service.processQuoteFollowUps(),
  );

  assert.equal(result.sent, 1);
  assert.equal(result.adminNotified, 0, 'no se cuenta un aviso que nunca llego');
});

test('sin Billing Contact se reporta el error y el proceso continua con las demas', async () => {
  const crm = buildCrm([
    quoteBase({ id: 'q1', billingContactId: undefined, cotizacinEnviadaPorWhatsapp: haceDias(10) }),
    quoteBase({ id: 'q2', name: 'COT-002', cotizacinEnviadaPorWhatsapp: haceDias(10) }),
  ]);
  const { sent, result } = await runService(crm);

  assert.equal(result.errors, 1);
  assert.equal(sent.length, 1, 'la segunda cotizacion si se procesa');
  assert.match(result.details.find(d => d.quoteId === 'q1').reason, /Contacto de Facturaci/);
});
