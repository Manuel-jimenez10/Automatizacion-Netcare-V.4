"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
/**
 * Lee un numero de las variables de entorno. Un valor mal escrito (o vacio)
 * cae al fallback en vez de convertirse en NaN, que desactivaria en silencio
 * los topes anti-spam.
 */
const num = (raw, fallback) => {
    if (raw === undefined || raw.trim() === '')
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
        console.warn(`⚠️ Valor numerico invalido en .env ("${raw}"). Se usa ${fallback}.`);
        return fallback;
    }
    return parsed;
};
exports.env = {
    espocrmBaseUrl: process.env.ESPOCRM_BASE_URL || '',
    espocrmApiKey: process.env.ESPOCRM_API_KEY || '',
    port: process.env.PORT || 3000,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM || '',
    twilioTemplateSid: process.env.TWILIO_TEMPLATE_SID || '',
    twilioQuoteTemplateSid: process.env.TWILIO_QUOTE_TEMPLATE_SID || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    testPhoneNumber: process.env.TEST_PHONE_NUMBER || '', // Número seguro para pruebas
    publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000', // URL pública para Twilio
    // Nombres de campos en EspoCRM (CONFIRMADOS)
    fieldCotizacionPropuesta: 'cotizacinPropuesta', // Archivo PDF de la cotización
    fieldCotizacionEnviadaWhatsapp: 'cotizacinEnviadaPorWhatsapp', // Fecha de envío por WhatsApp
    twilioStatusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL,
    storageUploadUrl: 'https://nc.salesontop.com/upload.php', // URL corregida
    storageToken: process.env.STORAGE_TOKEN || '', // Token para autenticación en PHP
    maxMediaSize: 16 * 1024 * 1024, // 16MB - límite de Twilio
    // Webhook interno para notificaciones de EspoCRM
    internalWebhookSecret: process.env.INTERNAL_WEBHOOK_SECRET || 'b37da2062c4d946e2642aa837dd274db',
    adminNotificationPhone: process.env.ADMIN_NOTIFICATION_PHONE || process.env.TEST_PHONE_NUMBER || '',
    notificationTemplateSid: process.env.NOTIFICATION_MESSAGE_SID || '',
    quotePresentedTemplateSid: process.env.QUOTE_PRESENTED_SID || '',
    quotePresentedTemplateName: process.env.QUOTE_PRESENTED_NAME || '',
    prefacturaConfirmedTemplateSid: process.env.PREFACTURA_PRESENTED || '',
    facturaPresentedTemplateSid: process.env.FACTURA_PRESENTED || '',
    facturaAdicionalTemplateSid: process.env.FACTURA_ADICIONAL || '',
    facturaPresentedXmlSid: process.env.FACTURA_PRESENTED_XML || '', // Template Quick Reply: "Solicitar mi XML"
    prefacturaReminder3DaysSid: process.env.TWILIO_PREFACTURA_REMINDER_3DAYS_SID || '',
    prefacturaReminderOverdueSid: process.env.TWILIO_PREFACTURA_REMINDER_OVERDUE_SID || '',
    mensajeIniciarWhatsapp: process.env.MENSAJE_INICIAR_WHATSAPP || '',
    // Modo prueba del envio masivo: telefonos separados por coma.
    // Si tiene valor, /send-all-contacts SOLO envia a estos numeros (ignora el reporte).
    // Vaciar la variable para volver al envio normal a todos los contactos.
    bulkTestRecipients: process.env.BULK_TEST_RECIPIENTS || '',
    // ID del Report de EspoCRM usado como audiencia del envio masivo.
    // Si esta vacio, se usa el reporte por defecto del codigo.
    bulkContactsReportId: process.env.BULK_CONTACTS_REPORT_ID || '',
    // ============================================================
    // NOTIFICACIONES A ADMINISTRADORES (mensajes entrantes)
    // ============================================================
    // Telefonos que reciben un aviso por cada mensaje nuevo de un cliente.
    // Separados por coma (se acepta cualquier formato: se normaliza a E.164).
    // Sin valor por defecto A PROPOSITO: vaciar la variable apaga la funcion y
    // ningun numero personal queda versionado en el repositorio.
    adminNotificationPhones: process.env.ADMIN_NOTIFICATION_PHONES || '',
    // Template de Twilio usado SOLO cuando la ventana de 24h del admin esta cerrada.
    // Contenido: "🔔 Tienes un mensaje nuevo de {{1}}. \nEl contenido es el
    // siguiente: {{2}}. ¡Revisa los detalles en el sistema!"
    adminNotificationTemplateSid: process.env.ADMIN_NOTIFICATION_TEMPLATE_SID ||
        process.env.NOTIFICATION_MESSAGE_SID ||
        '',
    // Texto plano enviado dentro de la ventana de 24h. Debe ser IDENTICO al
    // template para que el admin no note la diferencia. {{1}} = telefono del
    // cliente, {{2}} = contenido del mensaje.
    adminNotificationTextFormat: process.env.ADMIN_NOTIFICATION_TEXT_FORMAT ||
        '🔔 Tienes un mensaje nuevo de {{1}}. \nEl contenido es el siguiente: {{2}}. ¡Revisa los detalles en el sistema!',
    // Interruptor general. ADMIN_NOTIFICATION_ENABLED=false apaga la funcion.
    adminNotificationEnabled: (process.env.ADMIN_NOTIFICATION_ENABLED || 'true').toLowerCase() !== 'false',
    // Duracion de la ventana de servicio. WhatsApp usa 24h; dejamos un pequeno
    // margen configurable por si se quiere ser conservador (ej. 23).
    adminNotificationWindowHours: num(process.env.ADMIN_NOTIFICATION_WINDOW_HOURS, 24),
    // Anti-spam opcional: minutos minimos entre dos templates al MISMO admin
    // mientras su ventana siga cerrada. 0 = sin limite (comportamiento por defecto,
    // que es el flujo pedido: si el admin no responde, se sigue mandando template).
    adminNotificationTemplateCooldownMinutes: num(process.env.ADMIN_NOTIFICATION_TEMPLATE_COOLDOWN_MINUTES, 0),
    // Tope de seguridad: maximo de templates por administrador y por hora. Evita
    // que un pico de mensajes (o un abuso del endpoint) queme el sender ante Meta,
    // como en el incidente 63051. 0 = sin tope (no recomendado).
    adminNotificationMaxTemplatesPerHour: num(process.env.ADMIN_NOTIFICATION_MAX_TEMPLATES_PER_HOUR, 20),
    // Ruta del archivo donde se persisten las ventanas de 24h.
    adminNotificationStateFile: process.env.ADMIN_NOTIFICATION_STATE_FILE || '',
    // Reconstruir la ventana consultando el historial de Twilio tras un reinicio.
    adminNotificationRehydrate: (process.env.ADMIN_NOTIFICATION_REHYDRATE || 'true').toLowerCase() !== 'false',
    // Por defecto las respuestas de los administradores NO se guardan en EspoCRM
    // (solo sirven para reabrir la ventana). Ponlo en true si quieres registrarlas.
    adminNotificationLogAdminRepliesInCrm: (process.env.ADMIN_NOTIFICATION_LOG_ADMIN_REPLIES || 'false').toLowerCase() === 'true',
    // Longitud maxima del contenido del mensaje dentro de la notificacion.
    adminNotificationMaxBodyChars: num(process.env.ADMIN_NOTIFICATION_MAX_BODY_CHARS, 600),
    // Exigir el secreto compartido en /api/admin-notifications/*. Activo por
    // defecto: sin el, esos endpoints serian un emisor de WhatsApp abierto a
    // internet. Se acepta en el header x-webhook-secret o en el body { secret }.
    adminNotificationRequireSecret: (process.env.ADMIN_NOTIFICATION_REQUIRE_SECRET || 'true').toLowerCase() !== 'false',
};
// Aviso temprano y visible: si falta configuracion, las notificaciones a
// administradores no funcionan y conviene enterarse en el arranque, no cuando
// llegue el primer mensaje de un cliente.
if (exports.env.adminNotificationEnabled) {
    if (!exports.env.adminNotificationPhones) {
        console.warn('⚠️ [Notif Admin] ADMIN_NOTIFICATION_PHONES no esta configurada: no se enviaran avisos de mensajes entrantes.');
    }
    else if (!exports.env.adminNotificationTemplateSid) {
        console.warn('⚠️ [Notif Admin] ADMIN_NOTIFICATION_TEMPLATE_SID no esta configurada: solo se podra avisar dentro de la ventana de 24h.');
    }
    // El valor por defecto de INTERNAL_WEBHOOK_SECRET esta en el repositorio, asi
    // que no protege nada: hay que definirlo en el entorno.
    if (exports.env.adminNotificationRequireSecret && !process.env.INTERNAL_WEBHOOK_SECRET) {
        console.warn('🚨 [Notif Admin] INTERNAL_WEBHOOK_SECRET no esta definida: /api/admin-notifications/* queda protegido por un secreto publicado en el codigo. Definela en el entorno.');
    }
}
