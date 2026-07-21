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
- `{{2}}`: URL pública del campo `archivoAdjuntoId` del WhatsappTemplate.

La respuesta incluye un `jobId`. El progreso se consulta con:

**GET** `/api/templates/jobs/:jobId`

Para activarlo desde el checkbox de EspoCRM, el workflow del registro
`WhatsappTemplate` debe realizar el POST a `/api/templates/send-all-contacts`
enviando el ID del registro. El endpoint anterior `/api/templates/send` conserva
el comportamiento basado en reporte.

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
```

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
