"use strict";
/**
 * Notificaciones a administradores por cada mensaje entrante de un cliente.
 *
 * ┌─ FLUJO ───────────────────────────────────────────────────────────────┐
 * │ 1. Llega un mensaje de un CLIENTE (webhook de Twilio o workflow del   │
 * │    CRM).                                                              │
 * │ 2. Para cada administrador configurado:                               │
 * │      • Ventana de 24h CERRADA → se envía el TEMPLATE aprobado.        │
 * │      • Ventana de 24h ABIERTA → se envía TEXTO PLANO con el mismo     │
 * │        formato, así el template no se quema ante Meta.                │
 * │ 3. Cuando el administrador responde (cualquier mensaje suyo), su      │
 * │    ventana se abre y se reinicia a 24h desde ese instante.            │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * Nada de esto se registra en EspoCRM: son avisos internos y ensuciarían las
 * conversaciones de los clientes.
 *
 * NOTA DE DESPLIEGUE: el estado vive en el proceso (+ un JSON en disco). Está
 * pensado para UNA sola instancia. Con varias instancias las ventanas divergen
 * y la deduplicación deja de ser fiable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminNotificationService = exports.AdminNotificationService = void 0;
const env_1 = require("../config/env");
const twilio_service_1 = require("./twilio.service");
const admin_notification_session_store_1 = require("./admin-notification-session.store");
const notification_phone_utils_1 = require("../utils/notification-phone.utils");
/** Códigos de Twilio que significan "estás fuera de la ventana de 24h". */
const OUTSIDE_WINDOW_ERROR_CODES = new Set([63016]);
/**
 * Códigos que significan "Meta/Twilio nos está frenando". Insistir empeora la
 * calidad del sender, así que se pausa el template para ese administrador.
 * 63018 = demasiados mensajes al mismo destinatario
 * 63049 = template de marketing bloqueado por preferencias del usuario
 * 63051 = sender bloqueado (el incidente de julio 2026)
 * 429   = rate limit de la API
 */
const THROTTLE_ERROR_CODES = new Set([63018, 63049, 63051, 429]);
const THROTTLE_BACKOFF_MS = 60 * 60 * 1000; // 1 hora
/** Códigos que sugieren que el número de destino no es válido tal cual. */
const INVALID_DESTINATION_ERROR_CODES = new Set([21211, 21614, 63003]);
// Candado entre disparadores. Debe superar con holgura lo que tarda un
// fan-out completo (rehidratación + envíos), o el otro disparador entraría
// mientras el primero sigue en vuelo y llegaría un aviso duplicado.
const INFLIGHT_TTL_MS = 5 * 60 * 1000;
const DEDUPE_TTL_MS = 15 * 60 * 1000; // notificado con éxito
const SENT_SID_TTL_MS = 24 * 60 * 60 * 1000;
class AdminNotificationService {
    constructor(deps = {}) {
        /** dedupeKey → epoch ms de una notificación ya entregada. */
        this.deliveredKeys = new Map();
        /** dedupeKey → epoch ms de una notificación en curso (candado corto). */
        this.inflightKeys = new Map();
        /** SID de notificación → { admin destinatario, momento del envío }. */
        this.notificationSids = new Map();
        /** Rehidratación desde Twilio: una sola consulta por admin y por proceso. */
        this.rehydrated = new Map();
        /** Variante de número que Twilio aceptó (México: con o sin el "1"). */
        this.workingDestination = new Map();
        this.sendText = deps.sendText || twilio_service_1.sendTextMessage;
        this.sendTemplate = deps.sendTemplate || twilio_service_1.sendDynamicTemplateMessage;
        this.lookupLastInbound = deps.lookupLastInbound || twilio_service_1.getLastInboundMessageDate;
        this.admins = (0, notification_phone_utils_1.parsePhoneList)(deps.phones ?? env_1.env.adminNotificationPhones);
        this.store =
            deps.store ||
                new admin_notification_session_store_1.AdminNotificationSessionStore({
                    filePath: env_1.env.adminNotificationStateFile || undefined,
                    windowHours: env_1.env.adminNotificationWindowHours,
                });
    }
    // ─────────────────────────────────────────────────────────────
    // Consultas
    // ─────────────────────────────────────────────────────────────
    /** Lista de administradores configurados (E.164). */
    getAdmins() {
        return [...this.admins];
    }
    /**
     * ¿Este teléfono es uno de los administradores?
     *
     * Con la función apagada devuelve siempre false: `ADMIN_NOTIFICATION_ENABLED=false`
     * tiene que restaurar el comportamiento anterior por completo, incluido que
     * los mensajes de esos números vuelvan a registrarse en EspoCRM.
     */
    isAdminPhone(phone) {
        if (!phone || !env_1.env.adminNotificationEnabled)
            return false;
        return this.admins.some(admin => (0, notification_phone_utils_1.isSamePhone)(admin, phone));
    }
    /** ¿Este SID corresponde a una notificación interna? */
    isNotificationSid(sid) {
        if (!sid)
            return false;
        this.pruneSids();
        return this.notificationSids.has(sid);
    }
    /**
     * Un status callback nos trajo un error de entrega.
     *
     * Es la vía por la que llegan de verdad los 63018/63049/63051: `messages.create`
     * casi siempre responde `queued` y el rechazo de Meta aparece después. Sin
     * esto, el backoff nunca se activaría en producción.
     */
    handleDeliveryFailure(sid, errorCode) {
        if (!sid || !THROTTLE_ERROR_CODES.has(Number(errorCode)))
            return;
        this.pruneSids();
        const entry = this.notificationSids.get(sid);
        if (!entry)
            return;
        this.store.setBackoff(entry.phone, THROTTLE_BACKOFF_MS);
        console.error(`   🚨 [Notif Admin] Meta/Twilio rechazó ${sid} (${errorCode}) para ${(0, notification_phone_utils_1.maskPhone)(entry.phone)}. Sin avisos durante 1 hora.`);
    }
    /**
     * Estado de las ventanas. Los teléfonos van enmascarados salvo que se pida
     * lo contrario explícitamente (son datos personales).
     */
    getStatus(options = {}) {
        return {
            enabled: env_1.env.adminNotificationEnabled,
            templateConfigured: !!env_1.env.adminNotificationTemplateSid,
            windowHours: env_1.env.adminNotificationWindowHours,
            templateCooldownMinutes: env_1.env.adminNotificationTemplateCooldownMinutes,
            maxTemplatesPerHour: env_1.env.adminNotificationMaxTemplatesPerHour,
            admins: this.admins.map(phone => {
                const session = this.store.get(phone);
                const remainingMs = this.store.remainingMs(phone);
                const backoffMs = this.store.backoffRemainingMs(phone);
                return {
                    phone: options.revealPhones ? phone : (0, notification_phone_utils_1.maskPhone)(phone),
                    windowOpen: remainingMs > 0,
                    remainingMinutes: Math.round(remainingMs / 60000),
                    lastInboundAt: session.lastInboundAt
                        ? new Date(session.lastInboundAt).toISOString()
                        : null,
                    nextChannel: remainingMs > 0 ? 'text' : 'template',
                    templatesLastHour: this.store.templatesInLastHour(phone),
                    backoffMinutes: Math.round(backoffMs / 60000),
                    templatesSent: session.templatesSent,
                    freeTextSent: session.freeTextSent,
                };
            }),
        };
    }
    // ─────────────────────────────────────────────────────────────
    // Ventana de 24 horas
    // ─────────────────────────────────────────────────────────────
    /**
     * Registra un mensaje entrante de un administrador: abre/reinicia su
     * ventana de 24h. Cada mensaje suyo alarga la vida útil del template.
     */
    registerAdminReply(phone, body) {
        const admin = this.admins.find(a => (0, notification_phone_utils_1.isSamePhone)(a, phone)) || phone;
        this.store.registerInbound(admin);
        // La rehidratación ya no aporta nada: tenemos un dato más fresco.
        this.rehydrated.set((0, notification_phone_utils_1.phoneKey)(admin), Promise.resolve());
        const remainingHours = (this.store.remainingMs(admin) / 3600000).toFixed(1);
        console.log(`🔓 [Notif Admin] Ventana de 24h ABIERTA/REINICIADA para ${(0, notification_phone_utils_1.maskPhone)(admin)} (quedan ~${remainingHours}h)` +
            (body ? ` — respondió: "${(0, notification_phone_utils_1.sanitizeTemplateVariable)(body, 80)}"` : ' — sin texto (reacción o adjunto)'));
    }
    /** Limpia el estado de ventanas (mantenimiento / pruebas). */
    resetWindows(phone) {
        this.store.reset(phone);
        if (phone)
            this.rehydrated.delete((0, notification_phone_utils_1.phoneKey)(phone));
        else
            this.rehydrated.clear();
    }
    /**
     * Tras un reinicio del proceso podemos haber perdido la ventana. Antes de
     * decidir el canal, preguntamos UNA vez a Twilio si ese administrador nos
     * escribió en las últimas horas.
     */
    async ensureRehydrated(admin) {
        if (!env_1.env.adminNotificationRehydrate)
            return;
        const key = (0, notification_phone_utils_1.phoneKey)(admin);
        // Si ya sabemos que la ventana está abierta, no hay nada que reconstruir.
        if (this.store.remainingMs(admin) > 0) {
            this.rehydrated.set(key, Promise.resolve());
            return;
        }
        let pending = this.rehydrated.get(key);
        if (!pending) {
            pending = (async () => {
                try {
                    const lastInbound = await this.lookupLastInbound(admin, env_1.env.adminNotificationWindowHours);
                    if (lastInbound) {
                        this.store.registerInbound(admin, lastInbound.getTime());
                        console.log(`♻️ [Notif Admin] Ventana rehidratada desde Twilio para ${(0, notification_phone_utils_1.maskPhone)(admin)} (último mensaje suyo: ${lastInbound.toISOString()})`);
                    }
                }
                catch (error) {
                    // No cacheamos el fallo: si no, un 429 puntual dejaría la
                    // rehidratación desactivada para todo el proceso.
                    this.rehydrated.delete(key);
                    console.warn(`⚠️ [Notif Admin] Rehidratación fallida para ${(0, notification_phone_utils_1.maskPhone)(admin)} (se reintentará): ${error.message}`);
                }
            })();
            this.rehydrated.set(key, pending);
        }
        await pending;
    }
    // ─────────────────────────────────────────────────────────────
    // Envío
    // ─────────────────────────────────────────────────────────────
    /** Texto final que ve el administrador (idéntico por ambos canales). */
    buildNotificationText(fromPhone, body) {
        return env_1.env.adminNotificationTextFormat
            .replace(/\{\{\s*1\s*\}\}/g, fromPhone)
            .replace(/\{\{\s*2\s*\}\}/g, body);
    }
    /**
     * Punto de entrada principal. Nunca lanza: un fallo notificando no debe
     * romper el procesamiento del mensaje del cliente.
     */
    async notifyNewClientMessage(message) {
        const deliveries = [];
        if (!env_1.env.adminNotificationEnabled) {
            return { notified: false, reason: 'disabled', deliveries };
        }
        if (this.admins.length === 0) {
            console.warn('⚠️ [Notif Admin] No hay administradores configurados (ADMIN_NOTIFICATION_PHONES)');
            return { notified: false, reason: 'no_admins', deliveries };
        }
        if (!message.fromPhone) {
            return { notified: false, reason: 'missing_from', deliveries };
        }
        // Blindaje anti-bucle: un mensaje de un administrador jamás genera avisos.
        if (this.isAdminPhone(message.fromPhone)) {
            return { notified: false, reason: 'sender_is_admin', deliveries };
        }
        const key = message.dedupeKey;
        if (key && !this.claimKey(key)) {
            console.log(`↪ [Notif Admin] Mensaje ${key} ya notificado (o en curso). Se omite.`);
            return { notified: false, reason: 'duplicate', deliveries };
        }
        const fromVar = (0, notification_phone_utils_1.sanitizeTemplateVariable)(message.fromPhone, 40);
        const bodyVar = (0, notification_phone_utils_1.sanitizeTemplateVariable)(message.body, env_1.env.adminNotificationMaxBodyChars);
        const text = this.buildNotificationText(fromVar, bodyVar);
        console.log('\n🔔 ============================================');
        console.log(`🔔 Notificando mensaje nuevo de ${fromVar} a ${this.admins.length} administrador(es)`);
        console.log(`   Origen: ${message.source || 'desconocido'} | SID/ID: ${key || 'n/a'}`);
        console.log('🔔 ============================================');
        const settled = await Promise.allSettled(this.admins.map(admin => this.deliverToAdmin(admin, fromVar, bodyVar, text)));
        for (let i = 0; i < settled.length; i++) {
            const outcome = settled[i];
            deliveries.push(outcome.status === 'fulfilled'
                ? outcome.value
                : { phone: this.admins[i], channel: null, error: String(outcome.reason) });
        }
        const ok = deliveries.filter(d => d.sid).length;
        console.log(`🔔 [Notif Admin] Resultado: ${ok}/${deliveries.length} entregado(s)\n`);
        // Solo bloqueamos futuros reintentos si el aviso salió de verdad. Si todo
        // falló, dejamos que el otro disparador (Twilio o el CRM) lo reintente.
        if (key)
            this.releaseKey(key, ok > 0);
        return {
            notified: ok > 0,
            from: fromVar,
            preview: text,
            deliveries,
        };
    }
    async deliverToAdmin(admin, fromVar, bodyVar, text) {
        try {
            await this.ensureRehydrated(admin);
            // El backoff se aplica a AMBOS canales: si Meta o Twilio nos frenaron,
            // insistir por texto libre degrada el sender igual que por template.
            const backoffMs = this.store.backoffRemainingMs(admin);
            if (backoffMs > 0) {
                console.warn(`   ⏸️ [Notif Admin] Avisos a ${(0, notification_phone_utils_1.maskPhone)(admin)} en pausa ${Math.ceil(backoffMs / 60000)} min (Meta/Twilio nos frenó)`);
                return { phone: admin, channel: null, skipped: 'throttle_backoff' };
            }
            if (this.store.remainingMs(admin) > 0) {
                try {
                    return await this.sendFreeText(admin, text);
                }
                catch (error) {
                    if (!this.isOutsideWindowError(error))
                        throw error;
                    console.warn(`⚠️ [Notif Admin] Twilio reporta ventana cerrada para ${(0, notification_phone_utils_1.maskPhone)(admin)} (${error.code}). Se reintenta con template.`);
                    this.store.closeWindow(admin);
                }
            }
            return await this.sendTemplateNotification(admin, fromVar, bodyVar);
        }
        catch (error) {
            if (THROTTLE_ERROR_CODES.has(Number(error?.code))) {
                this.store.setBackoff(admin, THROTTLE_BACKOFF_MS);
                console.error(`   🚨 [Notif Admin] Meta/Twilio nos frenó (${error.code}) para ${(0, notification_phone_utils_1.maskPhone)(admin)}. Sin templates durante 1 hora.`);
            }
            console.error(`   ❌ [Notif Admin] Falló el envío a ${(0, notification_phone_utils_1.maskPhone)(admin)}: ${error.message}`);
            if (error.code)
                console.error(`      Código Twilio: ${error.code}`);
            return { phone: admin, channel: null, error: error.message };
        }
    }
    async sendFreeText(admin, text) {
        const message = await this.withDestinationFallback(admin, to => this.sendText({ phone: to, text, statusCallback: this.statusCallbackUrl() }));
        this.store.markFreeTextSent(admin);
        this.trackSid(message?.sid, admin);
        const remainingHours = (this.store.remainingMs(admin) / 3600000).toFixed(1);
        console.log(`   ✅ [Notif Admin] Texto plano a ${(0, notification_phone_utils_1.maskPhone)(admin)} (ventana abierta, quedan ~${remainingHours}h) — SID: ${message?.sid}`);
        return { phone: admin, channel: 'text', sid: message?.sid };
    }
    async sendTemplateNotification(admin, fromVar, bodyVar) {
        if (!env_1.env.adminNotificationTemplateSid) {
            const reason = 'ADMIN_NOTIFICATION_TEMPLATE_SID no configurado';
            console.warn(`   ⚠️ [Notif Admin] ${reason}`);
            return { phone: admin, channel: null, skipped: reason };
        }
        // El cupo se reserva ANTES del await: comprobar aquí e incrementar después
        // dejaría pasar toda una ráfaga concurrente sin que ningún envío viera a
        // los demás (que es justo el patrón que quemó el sender en julio 2026).
        const slot = this.store.reserveTemplateSlot(admin, {
            cooldownMs: env_1.env.adminNotificationTemplateCooldownMinutes * 60 * 1000,
            maxPerHour: env_1.env.adminNotificationMaxTemplatesPerHour,
        });
        if (!slot.allowed) {
            const detail = slot.retryInMinutes ? ` (faltan ${slot.retryInMinutes} min)` : '';
            console.warn(`   🛑 [Notif Admin] Template a ${(0, notification_phone_utils_1.maskPhone)(admin)} omitido: ${slot.reason}${detail}`);
            return { phone: admin, channel: null, skipped: slot.reason };
        }
        let message;
        try {
            message = await this.withDestinationFallback(admin, to => this.sendTemplate({
                phone: to,
                contentSid: env_1.env.adminNotificationTemplateSid,
                contentVariables: { '1': fromVar, '2': bodyVar },
                statusCallback: this.statusCallbackUrl(),
            }));
        }
        catch (error) {
            // No consumimos cupo por un mensaje que nunca salió.
            this.store.releaseTemplateSlot(admin, slot.timestamp);
            throw error;
        }
        this.trackSid(message?.sid, admin);
        console.log(`   ✅ [Notif Admin] Template a ${(0, notification_phone_utils_1.maskPhone)(admin)} (ventana cerrada) — SID: ${message?.sid}`);
        return { phone: admin, channel: 'template', sid: message?.sid };
    }
    // ─────────────────────────────────────────────────────────────
    // Auxiliares
    // ─────────────────────────────────────────────────────────────
    /**
     * México acepta el número con o sin el "1" tras el +52 según cómo esté dado
     * de alta en WhatsApp. Si Twilio rechaza el destino, reintentamos una vez
     * con la otra variante y recordamos cuál funcionó.
     */
    async withDestinationFallback(admin, send) {
        const key = (0, notification_phone_utils_1.phoneKey)(admin);
        const preferred = this.workingDestination.get(key) || admin;
        try {
            const result = await send(preferred);
            this.workingDestination.set(key, preferred);
            return result;
        }
        catch (error) {
            if (!INVALID_DESTINATION_ERROR_CODES.has(Number(error?.code)))
                throw error;
            const alternate = (0, notification_phone_utils_1.phoneVariants)(admin).find(v => v !== preferred);
            if (!alternate)
                throw error;
            console.warn(`   ↻ [Notif Admin] Destino rechazado (${error.code}). Reintentando ${(0, notification_phone_utils_1.maskPhone)(admin)} con la variante alterna.`);
            const result = await send(alternate);
            this.workingDestination.set(key, alternate);
            return result;
        }
    }
    /**
     * Callback dedicado para las notificaciones: así sus eventos de estado no
     * entran al handler que busca el SID en EspoCRM (no existe allí) ni siquiera
     * después de un reinicio, cuando el mapa en memoria está vacío.
     */
    statusCallbackUrl() {
        const base = (env_1.env.publicUrl || '').trim();
        if (!base.startsWith('https://'))
            return undefined;
        return `${base.replace(/\/$/, '')}/api/admin-notifications/status-callback`;
    }
    isOutsideWindowError(error) {
        if (!error)
            return false;
        if (OUTSIDE_WINDOW_ERROR_CODES.has(Number(error.code)))
            return true;
        const text = `${error.message || ''}`.toLowerCase();
        return text.includes('outside the allowed window');
    }
    /**
     * Reserva la clave para esta notificación. Devuelve false si otra ya la
     * entregó o la tiene en curso.
     */
    claimKey(key) {
        this.pruneMap(this.deliveredKeys, DEDUPE_TTL_MS);
        this.pruneMap(this.inflightKeys, INFLIGHT_TTL_MS);
        if (this.deliveredKeys.has(key) || this.inflightKeys.has(key))
            return false;
        this.inflightKeys.set(key, Date.now());
        return true;
    }
    releaseKey(key, delivered) {
        this.inflightKeys.delete(key);
        if (delivered)
            this.deliveredKeys.set(key, Date.now());
    }
    trackSid(sid, admin) {
        if (!sid)
            return;
        this.pruneSids();
        this.notificationSids.set(sid, { phone: admin, at: Date.now() });
    }
    pruneSids() {
        const cutoff = Date.now() - SENT_SID_TTL_MS;
        for (const [sid, entry] of this.notificationSids) {
            if (entry.at < cutoff)
                this.notificationSids.delete(sid);
        }
    }
    pruneMap(map, ttlMs) {
        const cutoff = Date.now() - ttlMs;
        for (const [key, timestamp] of map) {
            if (timestamp < cutoff)
                map.delete(key);
        }
    }
}
exports.AdminNotificationService = AdminNotificationService;
/** Instancia compartida usada por controladores y webhooks. */
exports.adminNotificationService = new AdminNotificationService();
