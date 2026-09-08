const assert = require('node:assert/strict');
const test = require('node:test');

process.env.WHATSAPP_INFO_SID = 'HX_INFO_TEST';

const { WhatsappInfoService } = require('../dist/services/whatsapp-info.service');
const { env } = require('../dist/config/env');

const TEXT_FIELD = env.whatsappInfoTextField;     // textoInformacion
const TRIGGER_FIELD = env.whatsappInfoTriggerField; // enviarInformacion

const messageBase = extra => ({
  id: 'wm-1',
  name: '+525512345678',
  contactId: 'contact-1',
  type: 'Out',
  // Sin punto final a proposito: la plantilla ya aporta el suyo tras {{2}}.
  [TEXT_FIELD]: 'Su equipo quedo instalado y probado',
  [TRIGGER_FIELD]: true,
  ...extra,
});

const buildCrm = (message, options = {}) => {
  const state = { ...message };
  const updates = [];

  return {
    state,
    updates,
    async getEntity(entityType, id) {
      if (entityType !== 'WhatsappMessage') throw new Error(`inesperado: ${entityType}`);
      if (id !== state.id) throw new Error('no existe');
      return { ...state };
    },
    async getContact(contactId) {
      if (options.contactFalla) throw new Error('EspoCRM 520');
      return {
        id: contactId,
        name: options.contactName || 'Ana Perez',
        phoneNumber: options.contactPhone || '+525599998888',
      };
    },
    async updateEntity(_entityType, _id, payload) {
      updates.push(payload);
      Object.assign(state, payload);
      return { ...state };
    },
  };
};

const buildService = (crm, overrides = {}) => {
  const texts = [];
  const templates = [];

  const service = new WhatsappInfoService({
    espoCRMClient: crm,
    async sendText(payload) {
      texts.push(payload);
      return { sid: `SM_TXT_${texts.length}`, body: payload.text };
    },
    async sendTemplate(payload) {
      templates.push(payload);
      return { sid: `SM_TPL_${templates.length}`, body: 'render de Twilio' };
    },
    async lookupLastInbound() {
      return overrides.lastInbound !== undefined ? overrides.lastInbound : null;
    },
    ...overrides.deps,
  });

  return { service, texts, templates };
};

test('fuera de la ventana de 24h se envia el TEMPLATE con nombre y texto', async () => {
  const crm = buildCrm(messageBase());
  const { service, texts, templates } = buildService(crm);

  const result = await service.handleSendInfo({ id: 'wm-1' });

  assert.equal(texts.length, 0);
  assert.equal(templates.length, 1);
  assert.equal(result.channel, 'template');
  assert.deepEqual(templates[0], {
    phone: '+525512345678',
    contentSid: 'HX_INFO_TEST',
    contentVariables: {
      1: 'Ana Perez',
      2: 'Su equipo quedo instalado y probado',
    },
  });
});

test('la plantilla aporta el punto final: si el agente lo escribe, salen dos', async () => {
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: 'Ya quedo listo.' }));
  const { service, texts } = buildService(crm, { lastInbound: new Date() });

  await service.handleSendInfo({ id: 'wm-1' });

  // Documenta el comportamiento real para que nadie se sorprenda: el "." tras
  // {{2}} es parte de la plantilla, no del texto del agente.
  assert.match(texts[0].text, /Ya quedo listo\.\./);
});

test('dentro de la ventana de 24h se envia TEXTO PLANO con el formato completo', async () => {
  const crm = buildCrm(messageBase());
  const { service, texts, templates } = buildService(crm, { lastInbound: new Date() });

  const result = await service.handleSendInfo({ id: 'wm-1' });

  assert.equal(templates.length, 0);
  assert.equal(texts.length, 1);
  assert.equal(result.channel, 'text');
  assert.equal(
    texts[0].text,
    'Estimado cliente Ana Perez,\nle queremos enviar información relacionada al servicio realizado recientemente. \nSu equipo quedo instalado y probado.\n\nAtentamente,\n\nNetcare Mx',
  );
  // El texto plano y el template dicen exactamente lo mismo.
  assert.equal(
    texts[0].text,
    service.buildText('Ana Perez', 'Su equipo quedo instalado y probado'),
  );
});

test('el texto plano RESPETA los saltos de linea; el template los aplasta', async () => {
  const conSaltos = 'Primera linea.\nSegunda linea.\n\nTercera.';

  const crmTexto = buildCrm(messageBase({ [TEXT_FIELD]: conSaltos }));
  const plano = buildService(crmTexto, { lastInbound: new Date() });
  await plano.service.handleSendInfo({ id: 'wm-1' });
  assert.match(plano.texts[0].text, /Primera linea\.\nSegunda linea\./);

  const crmTemplate = buildCrm(messageBase({ [TEXT_FIELD]: conSaltos }));
  const conTemplate = buildService(crmTemplate);
  await conTemplate.service.handleSendInfo({ id: 'wm-1' });
  // Meta rechaza las variables con saltos de linea: se convierten en espacios.
  assert.equal(
    conTemplate.templates[0].contentVariables['2'],
    'Primera linea. Segunda linea. Tercera.',
  );
});

test('tras enviar se guarda el SID y se DESMARCA la casilla', async () => {
  const crm = buildCrm(messageBase());
  const { service } = buildService(crm);

  await service.handleSendInfo({ id: 'wm-1' });

  const update = crm.updates[0];
  assert.equal(update.messageSid, 'SM_TPL_1');
  assert.equal(update.status, 'Sent');
  assert.equal(update.type, 'Out');
  assert.equal(update[TRIGGER_FIELD], false, 'la casilla debe quedar desmarcada');
  assert.equal(crm.state[TRIGGER_FIELD], false);
});

test('un registro que YA tiene messageSid no se reenvia', async () => {
  const crm = buildCrm(messageBase({ messageSid: 'SM_YA_ENVIADO' }));
  const { service, texts, templates } = buildService(crm);

  const result = await service.handleSendInfo({ id: 'wm-1' });

  assert.equal(result.status, 'ignored');
  assert.equal(result.reason, 'already_sent');
  assert.equal(texts.length + templates.length, 0);
});

test('dos disparos simultaneos del mismo registro solo envian una vez', async () => {
  const crm = buildCrm(messageBase());
  const { service, templates } = buildService(crm, {
    deps: {
      async sendTemplate(payload) {
        await new Promise(r => setTimeout(r, 20));
        templates.push?.(payload);
        return { sid: 'SM_TPL_LENTO', body: 'x' };
      },
    },
  });

  const [a, b] = await Promise.all([
    service.handleSendInfo({ id: 'wm-1' }),
    service.handleSendInfo({ id: 'wm-1' }),
  ]);

  const estados = [a.status, b.status].sort();
  assert.deepEqual(estados, ['ignored', 'sent']);
  assert.equal([a, b].find(r => r.status === 'ignored').reason, 'already_in_progress');
});

test('si el campo del texto esta vacio se falla con un mensaje que nombra el campo', async () => {
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: '   ' }));
  const { service, texts, templates } = buildService(crm);

  await assert.rejects(
    () => service.handleSendInfo({ id: 'wm-1' }),
    new RegExp(TEXT_FIELD),
  );
  assert.equal(texts.length + templates.length, 0);
});

test('si el campo del texto no existe (nombre mal configurado) tampoco se envia', async () => {
  const sinCampo = messageBase();
  delete sinCampo[TEXT_FIELD];
  const crm = buildCrm(sinCampo);
  const { service, templates } = buildService(crm);

  await assert.rejects(() => service.handleSendInfo({ id: 'wm-1' }), /WHATSAPP_INFO_TEXT_FIELD/);
  assert.equal(templates.length, 0);
});

test('si el registro no trae telefono se usa el del Contact vinculado', async () => {
  const crm = buildCrm(messageBase({ name: '' }));
  const { service, templates } = buildService(crm);

  await service.handleSendInfo({ id: 'wm-1' });

  assert.equal(templates[0].phone, '+525599998888');
});

test('sin telefono en el registro ni en el contacto, no se envia', async () => {
  const crm = buildCrm(messageBase({ name: '' }), { contactPhone: '123' });
  const { service, templates } = buildService(crm);

  await assert.rejects(() => service.handleSendInfo({ id: 'wm-1' }), /teléfono válido/);
  assert.equal(templates.length, 0);
});

test('si Twilio no responde al comprobar la ventana, se asume CERRADA y se usa template', async () => {
  const crm = buildCrm(messageBase());
  const { service, texts, templates } = buildService(crm, {
    deps: {
      async lookupLastInbound() { throw new Error('Twilio 429'); },
    },
  });

  const result = await service.handleSendInfo({ id: 'wm-1' });

  // El template siempre llega; el texto libre fuera de ventana fallaria con 63016.
  assert.equal(result.channel, 'template');
  assert.equal(texts.length, 0);
  assert.equal(templates.length, 1);
});

test('sin SID configurado y fuera de la ventana, se falla en vez de enviar algo que no llega', async () => {
  const original = env.whatsappInfoTemplateSid;
  env.whatsappInfoTemplateSid = '';

  try {
    const crm = buildCrm(messageBase());
    const { service } = buildService(crm);
    await assert.rejects(() => service.handleSendInfo({ id: 'wm-1' }), /WHATSAPP_INFO_SID/);
  } finally {
    env.whatsappInfoTemplateSid = original;
  }
});

test('acepta entity_id en snake_case, como el resto de workflows de EspoCRM', async () => {
  const crm = buildCrm(messageBase());
  const { service, templates } = buildService(crm);

  const result = await service.handleSendInfo({ entity_id: 'wm-1' });

  assert.equal(result.status, 'sent');
  assert.equal(templates.length, 1);
});

test('usa el contact_id del payload cuando el registro no trae el enlace', async () => {
  const sinContacto = messageBase();
  delete sinContacto.contactId;
  const crm = buildCrm(sinContacto, { contactName: 'Luis Gomez' });
  const { service, templates } = buildService(crm);

  await service.handleSendInfo({
    entity_id: 'wm-1',
    contact_id: 'contact-9',
    whatsapp_converstion_id: 'conv-1',
  });

  assert.equal(templates[0].contentVariables['1'], 'Luis Gomez');
});

test('sin contacto por ningun lado, el saludo cae a un generico', async () => {
  const sinContacto = messageBase();
  delete sinContacto.contactId;
  const crm = buildCrm(sinContacto);
  const { service, templates } = buildService(crm);

  await service.handleSendInfo({ entity_id: 'wm-1' });

  assert.equal(templates[0].contentVariables['1'], 'cliente');
  assert.equal(templates[0].phone, '+525512345678', 'usa el telefono del registro');
});

// ── Campo Wysiwyg: EspoCRM guarda HTML ──────────────────────────────────────

test('el HTML del editor se convierte a texto: el cliente NO ve etiquetas', async () => {
  const html = '<p>Su equipo quedo instalado</p><p>Todo probado</p>';
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: html }));
  const { service, texts } = buildService(crm, { lastInbound: new Date() });

  await service.handleSendInfo({ id: 'wm-1' });

  assert.doesNotMatch(texts[0].text, /<[a-z/]/i, 'no debe quedar ninguna etiqueta');
  assert.match(texts[0].text, /Su equipo quedo instalado\nTodo probado/);
});

test('negrita y cursiva del editor se traducen al formato de WhatsApp', async () => {
  const html = '<p>Su <strong>garantia</strong> es de <em>12 meses</em></p>';
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: html }));
  const { service, texts } = buildService(crm, { lastInbound: new Date() });

  await service.handleSendInfo({ id: 'wm-1' });

  assert.match(texts[0].text, /Su \*garantia\* es de _12 meses_/);
});

test('las listas del editor salen como vinetas', async () => {
  const html = '<ul><li>Camara instalada</li><li>Cableado revisado</li></ul>';
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: html }));
  const { service, texts } = buildService(crm, { lastInbound: new Date() });

  await service.handleSendInfo({ id: 'wm-1' });

  assert.match(texts[0].text, /• Camara instalada\n• Cableado revisado/);
});

test('caso real del editor: parrafos, negrita, lista y cierre, todo bien separado', async () => {
  const html =
    '<p>Su <strong>camara</strong> quedo instalada.</p>' +
    '<p>Trabajos realizados:</p>' +
    '<ul><li>Montaje en fachada</li><li>Configuracion de la app</li></ul>' +
    '<p>Cualquier duda, <em>quedamos atentos</em>.</p>';

  const crm = buildCrm(messageBase({ [TEXT_FIELD]: html }));
  const { service, texts } = buildService(crm, { lastInbound: new Date() });

  await service.handleSendInfo({ id: 'wm-1' });

  assert.match(
    texts[0].text,
    /Su \*camara\* quedo instalada\.\nTrabajos realizados:\n• Montaje en fachada\n• Configuracion de la app\nCualquier duda, _quedamos atentos_\./,
  );
});

test('las entidades HTML se decodifican (acentos, & y espacios duros)', async () => {
  const html = '<p>Instalaci&oacute;n &amp; puesta&nbsp;en marcha</p>';
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: html }));
  const { service, texts } = buildService(crm, { lastInbound: new Date() });

  await service.handleSendInfo({ id: 'wm-1' });

  assert.match(texts[0].text, /Instalación & puesta en marcha/);
});

test('un editor vacio (<p><br></p>) se trata como campo vacio', async () => {
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: '<p><br></p>' }));
  const { service, texts, templates } = buildService(crm);

  await assert.rejects(() => service.handleSendInfo({ id: 'wm-1' }), new RegExp(TEXT_FIELD));
  assert.equal(texts.length + templates.length, 0);
});

test('en el TEMPLATE el HTML se convierte y ademas se aplanan los saltos', async () => {
  const html = '<p>Linea uno</p><p>Linea dos</p>';
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: html }));
  const { service, templates } = buildService(crm);

  await service.handleSendInfo({ id: 'wm-1' });

  assert.equal(templates[0].contentVariables['2'], 'Linea uno Linea dos');
});

test('texto sin HTML se respeta tal cual (no se rompe un "< 100 > 50")', async () => {
  const crm = buildCrm(messageBase({ [TEXT_FIELD]: 'El costo es < 100 > 50 pesos' }));
  const { service, texts } = buildService(crm, { lastInbound: new Date() });

  await service.handleSendInfo({ id: 'wm-1' });

  assert.match(texts[0].text, /El costo es < 100 > 50 pesos/);
});

test('el texto se trunca al maximo configurado', async () => {
  const original = env.whatsappInfoMaxTextChars;
  env.whatsappInfoMaxTextChars = 20;

  try {
    const crm = buildCrm(messageBase({ [TEXT_FIELD]: 'a'.repeat(200) }));
    const { service, templates } = buildService(crm);
    await service.handleSendInfo({ id: 'wm-1' });

    assert.equal(templates[0].contentVariables['2'].length, 20);
    assert.match(templates[0].contentVariables['2'], /…$/);
  } finally {
    env.whatsappInfoMaxTextChars = original;
  }
});
