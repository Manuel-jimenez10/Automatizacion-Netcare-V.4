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

### Seguimiento de Quotes

**POST** `/api/quotes/run-followup`
- Ejecuta manualmente el proceso de seguimiento de Quotes
- Útil para testing y debugging

```bash
curl -X POST http://localhost:3000/api/quotes/run-followup
```

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

**IMPORTANTE:** Antes de ejecutar el sistema, debes crear un campo custom en EspoCRM:

1. Accede al panel de administración de EspoCRM
2. Ve a **Administration > Entity Manager > Quote**
3. Crea un nuevo campo:
   - **Nombre:** `followUpSentAt`
   - **Tipo:** DateTime
   - **Etiqueta:** "Follow-up Sent At"
   - **Descripción:** "Fecha y hora del primer envío de seguimiento"

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
- **Zona horaria:** America/Santo_Domingo (configurable en `src/jobs/quote-followup.job.ts`)

### Criterios de Búsqueda

El job busca Quotes que cumplan **todos** estos criterios:

1. ✅ `status = "Presented"`
2. ✅ `datePresented <= (hoy - 7 días)`
3. ✅ `followUpSentAt = null` (no notificadas previamente)

### Flujo del Proceso

```
1. Buscar Quotes elegibles
   ↓
2. Para cada Quote:
   a. Obtener Account asociado
   b. Obtener Billing Contact del Account
   c. Extraer y validar teléfono
   d. Enviar mensaje de WhatsApp
   e. Marcar Quote con followUpSentAt = now()
   ↓
3. Generar resumen en logs
```

### Prevención de Duplicados

Una vez enviado el mensaje, la Quote se marca con `followUpSentAt` (fecha/hora actual). En futuras ejecuciones, el filtro excluirá Quotes con este campo lleno, garantizando **un solo envío por Quote**.

---

## 🧪 Testing

### Preparación en EspoCRM

1. Crear campo custom `followUpSentAt` en Quote (ver sección Configuración)
2. Crear una Quote de prueba:
   - Status: `Presented`
   - datePresented: 8 días atrás
   - Account asociado con Billing Contact
   - Billing Contact con teléfono válido

### Prueba Manual

```bash
# Ejecutar proceso de seguimiento manualmente
curl -X POST http://localhost:3000/api/quotes/run-followup
```

### Verificación

1. ✅ Revisar logs del servidor (consulta de Quotes, obtención de datos)
2. ✅ Verificar que se envió el mensaje de WhatsApp
3. ✅ Verificar en EspoCRM que la Quote tiene `followUpSentAt` lleno
4. ✅ Ejecutar nuevamente y verificar que NO se envía mensaje duplicado

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
- **Marcado condicional:** Solo se actualiza `followUpSentAt` si el envío fue exitoso

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
