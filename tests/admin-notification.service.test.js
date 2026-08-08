const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Numeros FICTICIOS, con la misma forma que los reales para que las pruebas
// sigan siendo representativas (los reales viven solo en el entorno):
//   A y B -> Mexico con el "1" heredado (+52 1 + 10 digitos)
//   C     -> Venezuela (numero nacional de 9 digitos)
const ADMIN_A = '+5215550001111';
const ADMIN_B = '+5215550002222';
const ADMIN_C = '+584121112222';
const ADMINS = `${ADMIN_A}, ${ADMIN_B}, ${ADMIN_C}`;
const TEMPLATE_SID = 'HX_TEST_NOTIF';

// El SID se lee en dist/config/env al cargar el modulo: hay que fijarlo ANTES
// de los require de abajo.
process.env.ADMIN_NOTIFICATION_TEMPLATE_SID = TEMPLATE_SID;

const {
  AdminNotificationService,
} = require('../dist/services/admin-notification.service');
const {
  AdminNotificationSessionStore,
} = require('../dist/services/admin-notification-session.store');
const {
  isSamePhone,
  maskPhone,
  parsePhoneList,
  sanitizeTemplateVariable,
} = require('../dist/utils/notification-phone.utils');

/** Store aislado en un archivo temporal para no tocar el estado real. */
const tempStore = () =>
  new AdminNotificationSessionStore({
    filePath: path.join(os.tmpdir(), `admin-notif-${crypto.randomUUID()}.json`),
    windowHours: 24,
  });

/** Servicio con Twilio simulado. */
const buildService = (overrides = {}) => {
  const sentTexts = [];
  const sentTemplates = [];

  const service = new AdminNotificationService({
    phones: ADMINS,
    store: tempStore(),
    async lookupLastInbound() {
      return null; // sin historial en Twilio
    },
    async sendText(payload) {
      sentTexts.push(payload);
      return { sid: `SM_TEXT_${sentTexts.length}` };
    },
    async sendTemplate(payload) {
      sentTemplates.push(payload);
      return { sid: `SM_TPL_${sentTemplates.length}` };
    },
    ...overrides,
  });

  return { service, sentTexts, sentTemplates };
};

const phonesOf = list => list.map(item => item.phone).sort();

test('sin ventana abierta envia el template a los 3 administradores', async () => {
  const { service, sentTexts, sentTemplates } = buildService();

  const result = await service.notifyNewClientMessage({
    fromPhone: '+5215512345678',
    body: 'Hola, quiero informacion',
    dedupeKey: 'SM_CLIENT_1',
  });

  assert.equal(result.notified, true);
  assert.equal(sentTexts.length, 0);
  assert.equal(sentTemplates.length, 3);
  assert.deepEqual(phonesOf(sentTemplates), [ADMIN_A, ADMIN_B, ADMIN_C].sort());

  const toAdminA = sentTemplates.find(t => t.phone === ADMIN_A);
  assert.equal(toAdminA.contentSid, TEMPLATE_SID);
  assert.deepEqual(toAdminA.contentVariables, {
    1: '+5215512345678',
    2: 'Hola, quiero informacion',
  });
});

test('cuando el administrador responde se envia texto plano con el mismo formato', async () => {
  const { service, sentTexts, sentTemplates } = buildService();

  // Solo el administrador A responde.
  service.registerAdminReply(ADMIN_A, 'ok');

  await service.notifyNewClientMessage({
    fromPhone: '+5215512345678',
    body: 'Necesito una cotizacion',
    dedupeKey: 'SM_CLIENT_2',
  });

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].phone, ADMIN_A);
  assert.equal(
    sentTexts[0].text,
    '🔔 Tienes un mensaje nuevo de +5215512345678. \nEl contenido es el siguiente: Necesito una cotizacion. ¡Revisa los detalles en el sistema!',
  );

  // Los otros dos siguen recibiendo el template, con el MISMO texto renderizado.
  assert.deepEqual(phonesOf(sentTemplates), [ADMIN_B, ADMIN_C].sort());
  assert.equal(sentTemplates[0].contentVariables['2'], 'Necesito una cotizacion');
});

test('cada mensaje del administrador reinicia la ventana de 24h', async () => {
  const { service } = buildService();

  service.registerAdminReply(ADMIN_A);
  const status = () =>
    service.getStatus({ revealPhones: true }).admins.find(a => a.phone === ADMIN_A);

  const first = status();
  assert.equal(first.windowOpen, true);
  assert.equal(first.nextChannel, 'text');

  service.registerAdminReply(ADMIN_A);
  const second = status();
  assert.ok(second.remainingMinutes >= first.remainingMinutes);
  assert.ok(second.remainingMinutes <= 24 * 60);
});

test('una reaccion sin texto tambien abre la ventana del administrador', async () => {
  const { service, sentTexts } = buildService();

  service.registerAdminReply(ADMIN_A, undefined);

  await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'Hola' });

  assert.equal(sentTexts.length, 1);
  assert.equal(sentTexts[0].phone, ADMIN_A);
});

test('un mensaje enviado por un administrador nunca genera notificaciones (anti-bucle)', async () => {
  const { service, sentTexts, sentTemplates } = buildService();

  const result = await service.notifyNewClientMessage({
    fromPhone: ADMIN_B,
    body: 'Ya lo reviso',
    dedupeKey: 'SM_ADMIN_1',
  });

  assert.equal(result.notified, false);
  assert.equal(result.reason, 'sender_is_admin');
  assert.equal(sentTexts.length, 0);
  assert.equal(sentTemplates.length, 0);
});

test('el mismo MessageSid no se notifica dos veces', async () => {
  const { service, sentTemplates } = buildService();

  await service.notifyNewClientMessage({
    fromPhone: '+5215512345678',
    body: 'Primer intento',
    dedupeKey: 'SM_REPEATED',
  });
  const second = await service.notifyNewClientMessage({
    fromPhone: '+5215512345678',
    body: 'Primer intento',
    dedupeKey: 'SM_REPEATED',
  });

  assert.equal(second.notified, false);
  assert.equal(second.reason, 'duplicate');
  assert.equal(sentTemplates.length, 3);
});

test('si TODOS los envios fallan, el reintento del otro disparador si se procesa', async () => {
  let attempts = 0;
  const service = new AdminNotificationService({
    phones: ADMIN_A,
    store: tempStore(),
    async lookupLastInbound() { return null; },
    async sendText() { throw new Error('no deberia usarse'); },
    async sendTemplate() {
      attempts += 1;
      if (attempts === 1) throw new Error('Twilio caido');
      return { sid: 'SM_TPL_OK' };
    },
  });

  const first = await service.notifyNewClientMessage({
    fromPhone: '+5215512345678',
    body: 'Hola',
    dedupeKey: 'SM_RETRY',
  });
  assert.equal(first.notified, false);

  // El mismo SID debe poder reintentarse porque nunca se entregó.
  const second = await service.notifyNewClientMessage({
    fromPhone: '+5215512345678',
    body: 'Hola',
    dedupeKey: 'SM_RETRY',
  });
  assert.equal(second.notified, true);
  assert.equal(attempts, 2);
});

test('si Twilio responde 63016 se reintenta con el template y se cierra la ventana', async () => {
  const sentTemplates = [];
  let textAttempts = 0;

  const service = new AdminNotificationService({
    phones: ADMIN_A,
    store: tempStore(),
    async lookupLastInbound() { return null; },
    async sendText() {
      textAttempts += 1;
      const error = new Error('Failed to send freeform message because you are outside the allowed window.');
      error.code = 63016;
      throw error;
    },
    async sendTemplate(payload) {
      sentTemplates.push(payload);
      return { sid: 'SM_TPL_FALLBACK' };
    },
  });

  service.registerAdminReply(ADMIN_A);

  const result = await service.notifyNewClientMessage({
    fromPhone: '+5215512345678',
    body: 'Mensaje fuera de ventana',
  });

  assert.equal(textAttempts, 1);
  assert.equal(sentTemplates.length, 1);
  assert.equal(result.deliveries[0].channel, 'template');
  assert.equal(service.getStatus().admins[0].windowOpen, false);
});

test('un error de rate limit de Meta pausa el template una hora', async () => {
  let templateAttempts = 0;
  const service = new AdminNotificationService({
    phones: ADMIN_A,
    store: tempStore(),
    async lookupLastInbound() { return null; },
    async sendText() { throw new Error('no deberia usarse'); },
    async sendTemplate() {
      templateAttempts += 1;
      const error = new Error('Too many messages sent to one WhatsApp recipient');
      error.code = 63018;
      throw error;
    },
  });

  await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'A' });
  const status = service.getStatus().admins[0];
  assert.ok(status.backoffMinutes > 55);

  // El siguiente mensaje ya no vuelve a golpear a Twilio.
  const second = await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'B' });
  assert.equal(templateAttempts, 1);
  assert.equal(second.deliveries[0].skipped, 'throttle_backoff');
});

test('el tope de templates por hora aguanta una rafaga CONCURRENTE', async () => {
  const { env } = require('../dist/config/env');
  const original = env.adminNotificationMaxTemplatesPerHour;
  env.adminNotificationMaxTemplatesPerHour = 5;

  try {
    let sent = 0;
    const service = new AdminNotificationService({
      phones: ADMIN_A,
      store: tempStore(),
      async lookupLastInbound() { return null; },
      async sendText() { throw new Error('no deberia usarse'); },
      async sendTemplate() {
        sent += 1;
        // Latencia real: es lo que abre la ventana de carrera entre el
        // chequeo del tope y el registro del envio.
        await new Promise(resolve => setTimeout(resolve, 5));
        return { sid: `SM_BURST_${sent}` };
      },
    });

    // 25 webhooks a la vez, como una rafaga de mensajes de clientes.
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        service.notifyNewClientMessage({
          fromPhone: '+5215512345678',
          body: `Mensaje ${i}`,
          dedupeKey: `SM_BURST_CLIENT_${i}`,
        }),
      ),
    );

    assert.equal(sent, 5, `se enviaron ${sent} templates con un tope de 5`);
  } finally {
    env.adminNotificationMaxTemplatesPerHour = original;
  }
});

test('el cupo reservado se devuelve si el envio del template falla', async () => {
  const { env } = require('../dist/config/env');
  const original = env.adminNotificationMaxTemplatesPerHour;
  env.adminNotificationMaxTemplatesPerHour = 3;

  try {
    let attempts = 0;
    const store = tempStore();
    const service = new AdminNotificationService({
      phones: ADMIN_A,
      store,
      async lookupLastInbound() { return null; },
      async sendText() { throw new Error('no deberia usarse'); },
      async sendTemplate() {
        attempts += 1;
        throw new Error('Twilio caido');
      },
    });

    await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'A' });
    assert.equal(attempts, 1);
    // El fallo no debe consumir cupo del tope horario.
    assert.equal(store.templatesInLastHour(ADMIN_A), 0);
  } finally {
    env.adminNotificationMaxTemplatesPerHour = original;
  }
});

test('un 63051 recibido por status callback activa el backoff del administrador', async () => {
  const { service } = buildService();

  await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'Hola' });

  const sid = 'SM_TPL_1';
  assert.equal(service.isNotificationSid(sid), true);
  assert.equal(service.getStatus().admins[0].backoffMinutes, 0);

  service.handleDeliveryFailure(sid, '63051');

  assert.ok(service.getStatus().admins[0].backoffMinutes > 55);
});

test('/reset cierra la ventana pero conserva los topes anti-spam', async () => {
  const store = tempStore();
  const service = new AdminNotificationService({
    phones: ADMIN_A,
    store,
    async lookupLastInbound() { return null; },
    async sendText() { return { sid: 'SM_T' }; },
    async sendTemplate() { return { sid: 'SM_TPL' }; },
  });

  service.registerAdminReply(ADMIN_A);
  store.markTemplateSent(ADMIN_A);
  store.setBackoff(ADMIN_A, 30 * 60 * 1000);

  service.resetWindows();

  const status = service.getStatus().admins[0];
  assert.equal(status.windowOpen, false);
  assert.equal(status.templatesLastHour, 1);
  assert.ok(status.backoffMinutes > 25);
});

test('rehidrata la ventana desde el historial de Twilio tras un reinicio', async () => {
  const sentTexts = [];
  const hace2Horas = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const service = new AdminNotificationService({
    phones: ADMIN_A,
    store: tempStore(),
    async lookupLastInbound() { return hace2Horas; },
    async sendText(payload) {
      sentTexts.push(payload);
      return { sid: 'SM_TEXT_REHYDRATED' };
    },
    async sendTemplate() {
      throw new Error('No debe usarse el template: la ventana sigue abierta');
    },
  });

  await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'Hola' });

  assert.equal(sentTexts.length, 1);
});

test('un fallo al rehidratar no desactiva la rehidratacion para siempre', async () => {
  let lookups = 0;
  const service = new AdminNotificationService({
    phones: ADMIN_A,
    store: tempStore(),
    async lookupLastInbound() {
      lookups += 1;
      if (lookups === 1) throw new Error('429 Too Many Requests');
      return new Date(Date.now() - 60 * 60 * 1000);
    },
    async sendText() { return { sid: 'SM_TEXT_OK' }; },
    async sendTemplate() { return { sid: 'SM_TPL_OK' }; },
  });

  const first = await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'A' });
  assert.equal(first.deliveries[0].channel, 'template');

  const second = await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'B' });
  assert.equal(lookups, 2);
  assert.equal(second.deliveries[0].channel, 'text');
});

test('el SID de una notificacion se reconoce para ignorar su status callback', async () => {
  const { service } = buildService();

  await service.notifyNewClientMessage({ fromPhone: '+5215512345678', body: 'Hola' });

  assert.equal(service.isNotificationSid('SM_TPL_1'), true);
  assert.equal(service.isNotificationSid('SM_DE_UN_CLIENTE'), false);
});

test('reconoce al administrador aunque Mexico entregue el numero sin el 1', async () => {
  const { service } = buildService();

  assert.equal(service.isAdminPhone('+525550001111'), true);
  assert.equal(service.isAdminPhone('+5215550001111'), true);
  assert.equal(service.isAdminPhone('+584121112222'), true);
  assert.equal(service.isAdminPhone('+5215512345678'), false);
});

test('NO confunde clientes con administradores por los ultimos 10 digitos', async () => {
  const { service } = buildService();

  // Colisionarian con ADMIN_C (+58...) y ADMIN_A (+521...) si se comparasen
  // solo los ultimos 10 digitos. Son clientes reales y sus mensajes
  // deben registrarse con normalidad.
  assert.equal(service.isAdminPhone('+524121112222'), false);
  assert.equal(service.isAdminPhone('+14121112222'), false);
  assert.equal(service.isAdminPhone('+15550001111'), false);
});

test('utilidades de telefono y saneamiento de variables', () => {
  assert.deepEqual(parsePhoneList('+52 1 555 000 1111 , +58 412 1112222'), [
    '+5215550001111',
    '+584121112222',
  ]);
  // No duplica el mismo numero escrito de dos formas.
  assert.deepEqual(parsePhoneList('+5215550001111,+525550001111'), ['+5215550001111']);
  assert.equal(isSamePhone('+5215550001111', '525550001111'), true);
  assert.equal(isSamePhone('+5215550001111', '+5215512345678'), false);
  assert.equal(maskPhone('+5215550001111'), '+5215******111');

  // Meta rechaza saltos de linea y espacios consecutivos en las variables.
  assert.equal(sanitizeTemplateVariable('Hola\n\nmundo   con    espacios'), 'Hola mundo con espacios');
  assert.equal(sanitizeTemplateVariable(''), '(sin texto)');
  assert.equal(sanitizeTemplateVariable('abcdefghij', 5), 'abcd…');
});
