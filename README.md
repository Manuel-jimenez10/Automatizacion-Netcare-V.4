# Automatización de Seguimiento de Quotes en EspoCRM

## 📋 Descripción

Sistema de automatización para EspoCRM que envía mensajes de seguimiento por WhatsApp a clientes con cotizaciones (Quotes) pendientes.

### Funcionalidades

1. **Automatización de Tasks Completadas** (existente)
   - Webhook que envía WhatsApp cuando una Task se marca como "Completed"
   
2. **Seguimiento Automático de Quotes** (nuevo)
   - Cron job que se ejecuta diariamente a las 09:00 AM
   - Identifica Quotes con status "Presented" de 7+ días
   - Envía mensaje de seguimiento por WhatsApp al Billing Contact
   - Previene duplicados marcando Quotes como notificadas

---

## 🚀 Endpoints

### Envío asíncrono de un WhatsappTemplate a todos los Contacts

**POST** `/api/templates/send-all-contacts`

Este endpoint reutiliza el reporte `69c1bf528b8fb6477`, configurado para incluir
los contactos cuyo campo Phone tenga valor. Exporta sus columnas `name` y
`phone`/`phoneNumber`, responde `202 Accepted` inmediatamente y continúa el
envío en segundo plano.

```json
{
  "id": "ID_DEL_WHATSAPP_TEMPLATE"
}
```

Variables enviadas al template de Twilio:

- `{{1}}`: campo `name` del Contact.

La imagen se configura de forma estatica en el campo Media del template de
Twilio; este flujo no envia `{{2}}`. Para que Twilio reconozca el formato, se
puede usar la URL publica con extension:

`https://automatizacion-netcare-v-4-kvin.onrender.com/api/files/ID_ADJUNTO/imagen.jpg`

En `WhatsappMessage.description` y en el campo Último Mensaje de la conversación
se guarda el `body` final renderizado que devuelve Twilio, completo y sin usar
la previsualización `contentMessageTemplate`.

La respuesta incluye un `jobId`. El progreso se consulta con:

**GET** `/api/templates/jobs/:jobId`

Para activarlo desde el checkbox de EspoCRM, el workflow del registro
`WhatsappTemplate` debe realizar el POST a `/api/templates/send-all-contacts`
enviando el ID del registro. El endpoint anterior `/api/templates/send` conserva
el comportamiento basado en reporte.

### Notificaciones a administradores (mensajes entrantes)

Por **cada mensaje nuevo de un cliente** se avisa a los números configurados en
`ADMIN_NOTIFICATION_PHONES`. El aviso se envía por uno de dos canales según el
estado de la **ventana de servicio de 24 h de cada administrador**:

| Estado de la ventana del admin | Canal usado | Por qué |
|---|---|---|
| Cerrada (no nos ha escrito en 24 h) | Template aprobado `ADMIN_NOTIFICATION_TEMPLATE_SID` | Es lo único que WhatsApp permite fuera de la ventana |
| Abierta (nos escribió hace < 24 h) | Texto plano con el **mismo formato** del template | No gasta el template ante Meta |

```
🔔 Tienes un mensaje nuevo de {{1}}.
El contenido es el siguiente: {{2}}. ¡Revisa los detalles en el sistema!
```

- `{{1}}` = teléfono del cliente que escribió
- `{{2}}` = contenido de su mensaje

**Cada mensaje que envíe el administrador reinicia su ventana a 24 h**, así que
mientras siga contestando de vez en cuando el template no se vuelve a usar. La
ventana se lleva **por administrador**, de forma independiente: uno puede estar
recibiendo texto plano mientras otro sigue recibiendo el template.

#### Flujo completo

```
Cliente escribe ──► POST /api/whatsapp/incoming
                         │
                         ├─ ¿el remitente es un administrador?
                         │     SÍ → se reinicia su ventana de 24h y se corta
                         │          (no se crea nada en el CRM, no hay bucle)
                         │
                         └─ NO → por cada administrador:
                                   ventana abierta  → texto plano
                                   ventana cerrada  → template
                                 (en paralelo continúa el registro en EspoCRM)
```

#### Endpoints

Todos exigen el secreto compartido `INTERNAL_WEBHOOK_SECRET`
(`ADMIN_NOTIFICATION_REQUIRE_SECRET=true` por defecto), en el header
`x-webhook-secret` o en el body `{ "secret": "..." }`. Sin esa protección
cualquiera podría usarlos para emitir WhatsApp a los administradores.

**POST** `/api/admin-notifications/whatsapp-message`
Disparador opcional desde un workflow de EspoCRM cuando se **crea** un
`WhatsappMessage`. Acepta el payload completo de la entidad o solo `{ "id": "..." }`.
Solo notifica los mensajes con `type = "In"`; responde `202` de inmediato y
notifica en segundo plano. La deduplicación por `messageSid` evita el aviso
doble si Twilio ya lo notificó por el webhook.

```bash
curl -X POST https://<tu-app>/api/admin-notifications/whatsapp-message \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET" \
  -d '{"id":"ID_DEL_WHATSAPPMESSAGE"}'
```

**GET** `/api/admin-notifications/status`
Estado de la ventana de cada administrador: si está abierta, minutos restantes,
qué canal se usará en el próximo aviso, templates de la última hora y si hay una
pausa activa. Los teléfonos van enmascarados (`?reveal=true` los muestra).
El secreto va **solo en el header** (la app loguea cada `req.url`, así que en la
query string acabaría escrito en los logs).

```bash
curl -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET" \
  https://<tu-app>/api/admin-notifications/status
```

**POST** `/api/admin-notifications/test`
Envío de prueba. Body opcional: `{ "from": "+52...", "body": "texto" }`.

**POST** `/api/admin-notifications/reset`
Cierra las ventanas de 24 h para volver a probar el template. Body opcional:
`{ "phone": "+52..." }`. **No** borra los contadores anti-spam ni el backoff: si
lo hiciera, una sola petición desactivaría todas las protecciones.

**POST** `/api/admin-notifications/status-callback`
StatusCallback de Twilio para estos mensajes (lo llama Twilio, sin secreto).
Escribe el resultado en el log y, si Meta rechazó el envío, activa el backoff.

#### Detalles de implementación

- **Anti-bucle**: los mensajes de un administrador nunca generan notificaciones,
  y por defecto tampoco se registran en EspoCRM (`ADMIN_NOTIFICATION_LOG_ADMIN_REPLIES=false`).
  El reconocimiento del administrador compara la forma canónica del número
  (normalizando el "1" de México); **no** se comparan los últimos 10 dígitos,
  porque eso confundiría clientes reales con administradores y sus mensajes se
  perderían.
- **Reacciones**: un 👍 llega sin texto y sin adjunto. La detección del
  administrador ocurre antes de exigir contenido, así que reaccionar a la
  notificación también abre la ventana de 24 h.
- **Persistencia**: las ventanas se guardan en `data/admin-notification-sessions.json`
  para sobrevivir reinicios. Como el disco de Render es efímero entre despliegues,
  tras un arranque en frío la ventana también se **rehidrata consultando el
  historial de Twilio** (`ADMIN_NOTIFICATION_REHYDRATE=true`).
- **Fallback**: si Twilio responde `63016` (fuera de la ventana) al enviar texto
  libre, se reintenta automáticamente con el template y se marca la ventana como
  cerrada. Si rechaza el destino (`21211`/`63003`), se reintenta con la otra
  variante del número mexicano (con o sin el "1").
- **Freno ante Meta**: los errores `63018`, `63049`, `63051` y `429` pausan
  **ambos canales** para ese administrador durante 1 hora. Esos códigos llegan
  normalmente por el status callback (no en la respuesta de `messages.create`),
  así que el backoff se activa también desde ahí. Además hay un tope de
  `ADMIN_NOTIFICATION_MAX_TEMPLATES_PER_HOUR` (20 por defecto) que se **reserva
  antes** de enviar, para que aguante una ráfaga concurrente de webhooks —
  comprobarlo antes y contarlo después dejaría pasar la ráfaga entera, que es
  justo lo que degradó el sender en el incidente de julio 2026.
- **Apagado**: `ADMIN_NOTIFICATION_ENABLED=false` restaura el comportamiento
  anterior por completo — incluidos los mensajes de esos números, que vuelven a
  registrarse en EspoCRM con normalidad.
- **Saneamiento**: el contenido del mensaje se limpia de saltos de línea, tabuladores
  y espacios consecutivos (Meta los rechaza en variables de template) y se trunca a
  `ADMIN_NOTIFICATION_MAX_BODY_CHARS`. La misma limpieza se aplica al texto plano
  para que ambos canales se vean idénticos.
- Las notificaciones **no se registran en EspoCRM** y usan su propio
  `statusCallback`, para no ensuciar las conversaciones de los clientes ni gastar
  consultas al CRM buscando SIDs que no existen allí.
- **Restricción de despliegue**: el estado vive en el proceso. Está pensado para
  **una sola instancia**; con varias, las ventanas divergen y la deduplicación
  deja de ser fiable.

### Webhooks (Tasks)

**POST** `/api/webhooks/task-completed`
- Recibe notificación cuando una Task se completa
- Envía mensaje de WhatsApp al contacto asociado

```bash
curl -X POST http://localhost:3000/api/webhooks/task-completed \
  -H "Content-Type: application/json" \
  -d '{"taskId": "123abc"}'
```

### Seguimiento de cotizaciones

Ciclo cerrado de **2 seguimientos** por cotización presentada. Antes no había
contador: la única marca era la fecha del último envío y se reiniciaba en cada
envío, así que el cliente recibía un template cada 7 días **indefinidamente**
(~52 al año por cotización).

```
Cotización en 'Presented' + 7 días sin movimiento
        │
        ├─ contador 0 → 1   primer seguimiento
        ├─ contador 1 → 2   segundo seguimiento + aviso al administrador
        └─ contador 2       agotada: no se vuelve a enviar nunca

En cualquier punto: si el cliente responde → el ciclo se cierra.
```

Template al cliente (`QUOTE_FOLLOWUP_SID`):

```
Hola {{1}}! Vimos que la cotización {{2}} sigue pendiente y queremos ayudarte
a decidir mejor. ¿Cuál de estas opciones describe mejor tu situación?
```

- `{{1}}` = nombre del Billing Contact
- `{{2}}` = nombre de la cotización

Aviso al administrador al enviar el último seguimiento (`QUOTE_FOLLOWUP_EXHAUSTED_SID`):
`{{1}}` = nombre de la cotización, `{{2}}` = teléfono del Billing Contact. Se
envía a `ADMIN_NOTIFICATION_PHONES` reutilizando la misma maquinaria que las
notificaciones de mensajes entrantes (ventana de 24 h, reserva de cupo, tope por
hora y backoff ante Meta).

**POST** `/api/quotes/run-followup` — ejecuta el ciclo. Responde `202` y procesa
en segundo plano; `?dryRun=true` simula sin enviar nada. Exige el secreto
(`QUOTE_FOLLOWUP_REQUIRE_SECRET=true` por defecto): este endpoint dispara una
campaña completa y hasta un prefetch de navegador la lanzaría.

```bash
# Simulación: qué se enviaría hoy
curl -X POST "https://<tu-app>/api/quotes/run-followup?dryRun=true" \
  -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET"

# Resultado de la última ejecución (manual o del cron)
curl -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET" \
  https://<tu-app>/api/quotes/followup-status
```

**GET** `/api/quotes/followup-status` — resultado de la última corrida: enviados,
cerrados por respuesta, diferidos por el tope y la lista de errores por cotización.

#### Cómo se decide que el cliente respondió

Dos fuentes independientes; basta con que **una** vea la respuesta:

1. **EspoCRM** — `WhatsappMessage` de tipo `In` posteriores al último seguimiento.
   Se compara la forma canónica del teléfono, porque el entrante llega como
   `+521...` y el saliente se guardó como `+52...`.
2. **Historial de Twilio** — no depende del CRM ni del script PHP que resuelve el
   contacto, así que sobrevive a que el CRM esté degradado.

Se prefiere **sobre-detectar**: un falso positivo solo nos ahorra un seguimiento;
un falso negativo manda un segundo template a alguien que ya nos está hablando.

#### Garantías de seguridad del ciclo

- **El intento se reserva ANTES de enviar** (contador y fecha en un único PUT).
  Si se enviara primero y ese PUT fallara, al día siguiente se reenviaría el
  mismo template, y al otro también. Perder un seguimiento es barato; repetirlo no.
- **Verificación del campo contador**: EspoCRM ignora en silencio los atributos
  que no existen y responde `200`. Si el nombre de `QUOTE_FOLLOWUP_COUNTER_FIELD`
  no coincide, el módulo **aborta la corrida entera** con un error explícito en
  vez de enviar sin tope.
- **Relectura por ID antes de enviar**: el listado puede quedar obsoleto durante
  una corrida larga. Si la cotización ya pasó a `Closed Won`, no se envía.
- **Candado compartido** entre el cron y el endpoint manual, **pausa** entre
  envíos y **tope por corrida** (el resto se atiende al día siguiente).
- Paginación real: antes se leían como máximo 200 cotizaciones y el resto se
  ignoraba en silencio.

---

## ⚙️ Configuración

### 1. Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:

```bash
# EspoCRM Configuration
ESPOCRM_BASE_URL=https://tu-instancia.espocrm.com
ESPOCRM_API_KEY=tu_api_key_de_espocrm

# Server Configuration
PORT=3000

# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=tu_auth_token_de_twilio
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Twilio Templates
TWILIO_TEMPLATE_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # Template para Tasks completadas
TWILIO_QUOTE_TEMPLATE_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # Template para seguimiento de Quotes

# Webhook Security
WEBHOOK_SECRET=tu_secreto_webhook

# Notificaciones a administradores (mensajes entrantes)
ADMIN_NOTIFICATION_PHONES=+521XXXXXXXXXX,+521XXXXXXXXXX,+58XXXXXXXXXX
ADMIN_NOTIFICATION_TEMPLATE_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
INTERNAL_WEBHOOK_SECRET=un_secreto_largo_y_aleatorio
```

> El archivo `.env.example` en la raíz lista **todas** las variables del proyecto
> con su descripción, incluidas las opcionales de notificaciones.
>
> ⚠️ Los teléfonos reales de los administradores y el secreto **no se versionan**:
> se configuran en el entorno de despliegue (Render). Si `ADMIN_NOTIFICATION_PHONES`
> queda vacía, la función simplemente no envía nada y lo avisa en el arranque.

### 2. Configurar Campo Custom en EspoCRM

**IMPORTANTE:** el ciclo de seguimiento necesita un campo entero en `Quote`:

1. **Administration → Entity Manager → Quote → Fields**
2. Campo de tipo **Integer**, etiqueta "Seguimiento Cotización"
3. Copia su **nombre interno** (aparece bajo la etiqueta) en
   `QUOTE_FOLLOWUP_COUNTER_FIELD`

⚠️ EspoCRM genera el nombre interno quitando los acentos: si la etiqueta lleva
tilde, el campo se llama `seguimientoCotizacin` (como los ya existentes
`cotizacinPropuesta` y `cotizacinEnviadaPorWhatsapp`). Si el nombre no coincide,
el módulo **aborta la corrida** con un error explícito antes de enviar nada —
EspoCRM ignora en silencio los campos que no existen, así que sin esa
comprobación el contador se leería siempre como 0 y no habría tope.

El campo `followUpSentAt` que describían versiones anteriores de este documento
**no se usa**: el control lo lleva el contador junto con `cotizacinEnviadaPorWhatsapp`.

### 3. Configurar Templates de WhatsApp en Twilio

Necesitas dos templates aprobados en Twilio:

#### Template 1: Task Completada
Variables: `{{1}}` (nombre cliente), `{{2}}` (nombre task)

```
Hola {{1}}, te informamos que la tarea "{{2}}" ha sido completada exitosamente.
```

#### Template 2: Seguimiento de Quote
Variables: `{{1}}` (nombre cliente), `{{2}}` (nombre cotización)

```
Hola {{1}}, te contactamos para dar seguimiento a la cotización "{{2}}". ¿Pudiste revisarla? ¿Necesitas alguna aclaración o apoyo adicional?
```

---

## 📦 Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Compilar TypeScript
npm run build

# 3. Iniciar en desarrollo
npm run dev

# 4. Iniciar en producción
npm start
```

---

## 🔄 Cron Job - Seguimiento de Quotes

### Configuración

El cron job se ejecuta automáticamente al iniciar el servidor:
- **Frecuencia:** Diaria
- **Horario:** 09:00 AM
- **Zona horaria:** America/Mexico_City (configurable en `src/jobs/quote-followup.job.ts`)

Comparte candado con `POST /api/quotes/run-followup`: si el proceso ya está en
marcha, la otra vía se salta esa ejecución en vez de duplicar envíos.

### Criterios

Una cotización recibe seguimiento cuando cumple **todo** esto:

1. `status = "Presented"` (se re-verifica leyendo la cotización justo antes de enviar)
2. Han pasado ≥ `QUOTE_FOLLOWUP_DAYS` desde el último movimiento
   (último WhatsApp enviado → fecha de presentación → última modificación → creación)
3. El contador es menor que `QUOTE_FOLLOWUP_MAX_ATTEMPTS`
4. El cliente **no** ha respondido desde ese último movimiento

### Flujo del proceso

```
1. Verificar que el campo contador existe en EspoCRM  (si no → abortar)
2. Descargar TODAS las Presented (paginando)
3. Por cada cotización:
   a. Filtros baratos con los datos del listado (contador, días)
   b. Releer la cotización por ID (estado y contador frescos)
   c. Billing Contact → teléfono
   d. ¿Respondió el cliente?  (EspoCRM + Twilio)  → sí: cerrar ciclo
   e. Reservar el intento (contador + fecha, un solo PUT)
   f. Enviar el template
   g. Si era el último → avisar al administrador
   h. Pausa
4. Resumen con la lista de IDs por resultado
```

### Frenos de seguridad

| Freno | Variable | Por defecto |
|---|---|---|
| Máximo de seguimientos por cotización | `QUOTE_FOLLOWUP_MAX_ATTEMPTS` | 2 |
| Envíos por corrida (el resto se difiere) | `QUOTE_FOLLOWUP_MAX_PER_RUN` | 40 |
| Envíos por día (cron + llamadas manuales) | `QUOTE_FOLLOWUP_MAX_PER_DAY` | 120 |
| Un seguimiento por cliente y corrida | — | siempre |
| Pausa entre envíos | `QUOTE_FOLLOWUP_DELAY_MS` | 1500 ms |

Si Twilio devuelve un código terminal (`21610` opt-out, `63049` marketing
bloqueado, destino inválido), el ciclo de esa cotización se cierra en el acto:
no habrá un segundo intento contra alguien que pidió no recibir mensajes.

Y si **ninguna** de las dos fuentes puede comprobar si el cliente respondió
(EspoCRM caído y Twilio con rate limit), esa cotización se pospone al día
siguiente en vez de enviar a ciegas.

---

## 🧪 Testing

### Suite automática

```bash
npm test
```

Cubre el ciclo de seguimiento (contador, corte por respuesta, topes, opt-out,
abort por campo mal configurado) y las notificaciones a administradores
(ventana de 24 h, deduplicación, backoff).

### Preparación en EspoCRM

1. Crear el campo entero de seguimiento en Quote (ver sección Configuración)
2. Crear una Quote de prueba:
   - Status: `Presented`
   - datePresented: 8 días atrás
   - Billing Contact con teléfono válido

### Prueba manual

**Empieza siempre por la simulación**: dice exactamente qué se enviaría, sin
enviar nada.

```bash
curl -X POST "http://localhost:3000/api/quotes/run-followup?dryRun=true" \
  -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET"

curl -H "x-webhook-secret: $INTERNAL_WEBHOOK_SECRET" \
  http://localhost:3000/api/quotes/followup-status
```

### Verificación

1. ✅ El log muestra `Campo contador "..." verificado en EspoCRM`
2. ✅ La simulación lista las cotizaciones esperadas con `would_send`
3. ✅ Tras el envío real, el contador de la Quote sube en 1
4. ✅ Al ejecutar de nuevo el mismo día, esas cotizaciones salen como `waiting`
5. ✅ Al llegar el contador a 2, llega el aviso al administrador

---

## 📁 Estructura del Proyecto

```
src/
├── config/
│   └── env.ts                          # Configuración de variables de entorno
├── controllers/
│   ├── quote-followup.controller.ts    # Controlador para seguimiento de Quotes
│   ├── test.controller.ts
│   └── whatsapp.controller.ts          # Controlador para webhook de Tasks
├── interfaces/
│   └── interfaces.ts                   # Interfaces TypeScript (Quote, Account, etc.)
├── jobs/
│   └── quote-followup.job.ts          # Cron job para seguimiento diario
├── routes/
│   ├── index.ts                        # Router principal
│   ├── quote-followup.routes.ts        # Rutas de seguimiento de Quotes
│   ├── test.routes.ts
│   └── webhook.routes.ts               # Rutas de webhooks
├── services/
│   ├── espocrm-api-client.service.ts   # Cliente EspoCRM (consultas y updates)
│   ├── quote-followup.service.ts       # Servicio orquestador de seguimiento
│   ├── task-completion.service.ts      # Servicio para Tasks completadas
│   └── twilio.service.ts               # Cliente Twilio (envío de WhatsApp)
├── app.ts                              # Configuración de Express
└── server.ts                           # Punto de entrada (inicia cron job)
```

---

## 🛠️ Arquitectura

### Separación de Responsabilidades

```
┌─────────────────┐
│   Cron Job      │  jobs/quote-followup.job.ts
│   (Scheduler)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Orquestador    │  services/quote-followup.service.ts
│  (Lógica de     │  - Consulta Quotes
│   Negocio)      │  - Procesa individualmente
│                 │  - Coordina Account → Contact → WhatsApp
└────┬───────┬────┘
     │       │
     ▼       ▼
┌─────────┐ ┌─────────┐
│ EspoCRM │ │ Twilio  │
│ Client  │ │ Service │
└─────────┘ └─────────┘
```

### Manejo de Errores

- **Errores individuales:** Si una Quote falla, se loguea y se continúa con la siguiente
- **Validaciones tempranas:** Se verifica que existan Account, Billing Contact y Phone antes de enviar
- **Logs detallados:** Cada paso del proceso se registra para debugging
- **Reserva antes del envío:** el contador y la fecha se escriben ANTES de llamar
  a Twilio. Si se hiciera al revés y ese PUT fallara, el mismo template se
  reenviaría cada día. Perder un seguimiento es barato; repetirlo no.

---

## 📝 Logs

El sistema genera logs detallados en cada ejecución:

```
🚀 ============================================
🚀 Iniciando proceso de seguimiento de Quotes
🚀 ============================================

📅 Buscando Quotes presentadas antes de: 2025-12-15
🔍 Buscando Quote con filtros: [...]
✅ Encontrados 3 Quote(s)

📊 Se encontraron 3 Quote(s) para procesar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Procesando Quote: "Cotización Proyecto X" (ID: 123abc)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 Account ID: 456def
🏢 Obteniendo Account con ID: 456def
✅ Account obtenido: Empresa ACME
🔗 Billing Contact ID: 789ghi
👤 Obteniendo Contact con ID: 789ghi
✅ Contact obtenido: Juan Pérez
🔍 Buscando número de teléfono en el contacto...
   ✓ Teléfono encontrado en campo: phoneMobile
   ✓ Número limpiado y validado: +1234567890
📞 Teléfono válido: +1234567890
👤 Cliente: Juan Pérez
📱 Enviando mensaje de seguimiento...
📱 Enviando WhatsApp de seguimiento de Quote a: +1234567890
✅ Mensaje de seguimiento de Quote enviado exitosamente
   - SID: SMxxxxxxxxxx
   - Estado: queued
   - Template: HXxxxxxxxxxx
📝 Marcando Quote como notificada...
✅ Quote actualizado exitosamente
✅ Quote "Cotización Proyecto X" procesada exitosamente
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 ============================================
📊 RESUMEN DEL PROCESO
📊 ============================================
   Total Quotes encontradas: 3
   ✅ Procesadas exitosamente: 3
   ❌ Con errores: 0
📊 ============================================
```

---

## 🔒 Seguridad

- Las credenciales se almacenan en variables de entorno (nunca en código)
- El webhook de Tasks valida el secreto compartido (`WEBHOOK_SECRET`)
- Las API Keys de EspoCRM y Twilio se envían de forma segura en headers

---

## 📞 Soporte

Para problemas o preguntas, revisar:
1. Logs del servidor (detallados)
2. Panel de Twilio (estado de mensajes)
3. EspoCRM (verificar datos de Quotes/Accounts/Contacts)

---

## 🔄 Próximas Mejoras

- [ ] Configurar horario del cron job via variable de entorno
- [ ] Dashboard para visualizar estadísticas de envíos
- [ ] Notificaciones por email en caso de errores críticos
- [ ] Soporte para múltiples plantillas de mensajes
