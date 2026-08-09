"use strict";
/**
 * Ventana de servicio de 24 horas POR ADMINISTRADOR.
 *
 * WhatsApp solo permite enviar texto libre a un número durante las 24 horas
 * siguientes a su último mensaje entrante. Fuera de esa ventana hay que usar
 * un template aprobado.
 *
 * Aquí llevamos esa cuenta nosotros mismos para:
 *   1. Enviar el template SOLO cuando la ventana está cerrada.
 *   2. Enviar texto plano (con el mismo formato del template) mientras esté
 *      abierta, y así no quemar el template ante Meta.
 *   3. Reiniciar el contador con CADA mensaje que el administrador nos envíe.
 *
 * El estado se persiste en disco para sobrevivir reinicios del proceso. En
 * Render el disco es efímero entre despliegues, por eso el servicio también
 * puede rehidratar la ventana consultando el historial de Twilio.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminNotificationSessionStore = exports.DEFAULT_KIND = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const notification_phone_utils_1 = require("../utils/notification-phone.utils");
const emptySession = (phone) => ({
    phone,
    lastInboundAt: 0,
    lastTemplateAt: 0,
    templateTimestamps: [],
    backoffUntil: 0,
    templatesSent: 0,
    freeTextSent: 0,
});
const HOUR_MS = 60 * 60 * 1000;
/** Tipo de aviso por defecto: los mensajes entrantes de clientes. */
exports.DEFAULT_KIND = 'inbound';
class AdminNotificationSessionStore {
    constructor(options = {}) {
        this.sessions = new Map();
        this.persistTimer = null;
        this.persistDisabled = false;
        const hours = options.windowHours && options.windowHours > 0 ? options.windowHours : 24;
        this.windowMs = hours * 60 * 60 * 1000;
        this.filePath =
            options.filePath || path_1.default.join(process.cwd(), 'data', 'admin-notification-sessions.json');
        this.load();
    }
    // ─────────────────────────────────────────────────────────────
    // Lectura
    // ─────────────────────────────────────────────────────────────
    /** ¿La ventana de 24h de este administrador sigue abierta? */
    isWindowOpen(phone) {
        return this.remainingMs(phone) > 0;
    }
    /** Milisegundos que le quedan a la ventana (0 si está cerrada). */
    remainingMs(phone) {
        const session = this.sessions.get((0, notification_phone_utils_1.phoneKey)(phone));
        if (!session || !session.lastInboundAt)
            return 0;
        const remaining = session.lastInboundAt + this.windowMs - Date.now();
        return remaining > 0 ? remaining : 0;
    }
    /** Epoch ms del último mensaje del administrador (0 si nunca respondió). */
    lastInboundAt(phone) {
        return this.sessions.get((0, notification_phone_utils_1.phoneKey)(phone))?.lastInboundAt || 0;
    }
    /** Epoch ms del último template enviado a este administrador. */
    lastTemplateAt(phone) {
        return this.sessions.get((0, notification_phone_utils_1.phoneKey)(phone))?.lastTemplateAt || 0;
    }
    /** Templates de ese tipo enviados a este administrador en la última hora. */
    templatesInLastHour(phone, kind = exports.DEFAULT_KIND) {
        const session = this.sessions.get((0, notification_phone_utils_1.phoneKey)(phone));
        if (!session)
            return 0;
        return this.recentTimestamps(session, kind).length;
    }
    /** Lista (ya podada) de marcas de tiempo de la última hora para ese tipo. */
    recentTimestamps(session, kind) {
        const cutoff = Date.now() - HOUR_MS;
        if (kind === exports.DEFAULT_KIND) {
            session.templateTimestamps = session.templateTimestamps.filter(t => t >= cutoff);
            return session.templateTimestamps;
        }
        if (!session.templateTimestampsByKind)
            session.templateTimestampsByKind = {};
        const current = session.templateTimestampsByKind[kind] || [];
        session.templateTimestampsByKind[kind] = current.filter(t => t >= cutoff);
        return session.templateTimestampsByKind[kind];
    }
    /** Milisegundos que faltan para que termine el backoff impuesto por Meta. */
    backoffRemainingMs(phone) {
        const until = this.sessions.get((0, notification_phone_utils_1.phoneKey)(phone))?.backoffUntil || 0;
        const remaining = until - Date.now();
        return remaining > 0 ? remaining : 0;
    }
    /**
     * Frena los templates a este administrador durante un rato. Se usa cuando
     * Twilio/Meta responden con un error de límite o de bloqueo: insistir es
     * justamente lo que degrada la calidad del sender.
     */
    setBackoff(phone, durationMs) {
        const session = this.ensure(phone);
        const until = Date.now() + durationMs;
        if (until > session.backoffUntil) {
            session.backoffUntil = until;
            this.schedulePersist();
        }
    }
    /** Estado completo de un administrador (para diagnóstico). */
    get(phone) {
        return this.sessions.get((0, notification_phone_utils_1.phoneKey)(phone)) || emptySession(phone);
    }
    /** Copia del estado de todos los administradores conocidos. */
    snapshot() {
        return [...this.sessions.values()].map(s => ({ ...s }));
    }
    // ─────────────────────────────────────────────────────────────
    // Escritura
    // ─────────────────────────────────────────────────────────────
    /**
     * El administrador nos escribió: abre (o reinicia) su ventana de 24h.
     * `timestamp` permite rehidratar desde el historial de Twilio.
     */
    registerInbound(phone, timestamp = Date.now()) {
        const session = this.ensure(phone);
        // Nunca retrocedemos la ventana: un dato rehidratado más viejo no debe
        // pisar un mensaje reciente que ya habíamos registrado.
        if (timestamp > session.lastInboundAt) {
            session.lastInboundAt = timestamp;
            this.schedulePersist();
        }
        return session;
    }
    markTemplateSent(phone, timestamp = Date.now(), kind = exports.DEFAULT_KIND) {
        const session = this.ensure(phone);
        session.lastTemplateAt = timestamp;
        session.templatesSent += 1;
        this.recentTimestamps(session, kind).push(timestamp);
        this.schedulePersist();
    }
    /**
     * Comprueba los límites y, si pasan, apunta el envío EN EL MISMO PASO
     * SÍNCRONO. Es lo que hace que los topes funcionen bajo ráfaga: si se
     * comprobara antes del `await` y se apuntara después, N envíos concurrentes
     * leerían todos el mismo contador y ninguno vería a los demás.
     *
     * Si el envío falla, hay que llamar a `releaseTemplateSlot` con el timestamp
     * devuelto para no consumir cupo por un mensaje que nunca salió.
     */
    reserveTemplateSlot(phone, limits = {}) {
        const now = Date.now();
        const kind = limits.kind || exports.DEFAULT_KIND;
        const backoffMs = this.backoffRemainingMs(phone);
        if (backoffMs > 0) {
            return {
                allowed: false,
                reason: 'throttle_backoff',
                retryInMinutes: Math.ceil(backoffMs / 60000),
            };
        }
        const cooldownMs = limits.cooldownMs || 0;
        if (cooldownMs > 0) {
            const sinceLast = now - this.lastTemplateAt(phone);
            if (sinceLast < cooldownMs) {
                return {
                    allowed: false,
                    reason: 'template_cooldown',
                    retryInMinutes: Math.ceil((cooldownMs - sinceLast) / 60000),
                };
            }
        }
        const maxPerHour = limits.maxPerHour || 0;
        if (maxPerHour > 0 && this.templatesInLastHour(phone, kind) >= maxPerHour) {
            return { allowed: false, reason: 'hourly_cap' };
        }
        this.markTemplateSent(phone, now, kind);
        return { allowed: true, timestamp: now };
    }
    /** Devuelve el cupo reservado cuando el envío acabó fallando. */
    releaseTemplateSlot(phone, timestamp, kind = exports.DEFAULT_KIND) {
        if (!timestamp)
            return;
        const session = this.sessions.get((0, notification_phone_utils_1.phoneKey)(phone));
        if (!session)
            return;
        const timestamps = this.recentTimestamps(session, kind);
        const index = timestamps.lastIndexOf(timestamp);
        if (index >= 0)
            timestamps.splice(index, 1);
        if (session.templatesSent > 0)
            session.templatesSent -= 1;
        session.lastTemplateAt = timestamps.length ? timestamps[timestamps.length - 1] : 0;
        this.schedulePersist();
    }
    markFreeTextSent(phone) {
        const session = this.ensure(phone);
        session.freeTextSent += 1;
        this.schedulePersist();
    }
    /**
     * Cierra la ventana a la fuerza. Se usa cuando Twilio nos responde que el
     * mensaje libre quedó fuera de la ventana: nuestro reloj estaba equivocado.
     */
    closeWindow(phone) {
        const session = this.ensure(phone);
        session.lastInboundAt = 0;
        this.schedulePersist();
    }
    /**
     * Cierra las ventanas de 24h (endpoint de mantenimiento / pruebas).
     *
     * NO borra los contadores anti-spam ni el backoff: si lo hiciera, una sola
     * petición a /reset desactivaría todas las protecciones contra el bloqueo
     * del sender.
     */
    reset(phone) {
        const targets = phone ? [(0, notification_phone_utils_1.phoneKey)(phone)] : [...this.sessions.keys()];
        for (const key of targets) {
            const session = this.sessions.get(key);
            if (session)
                session.lastInboundAt = 0;
        }
        this.schedulePersist();
    }
    // ─────────────────────────────────────────────────────────────
    // Internos
    // ─────────────────────────────────────────────────────────────
    ensure(phone) {
        const key = (0, notification_phone_utils_1.phoneKey)(phone);
        let session = this.sessions.get(key);
        if (!session) {
            session = emptySession(phone);
            this.sessions.set(key, session);
        }
        else if (phone && session.phone !== phone) {
            session.phone = phone;
        }
        return session;
    }
    load() {
        try {
            if (!fs_1.default.existsSync(this.filePath))
                return;
            const raw = fs_1.default.readFileSync(this.filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            for (const [key, value] of Object.entries(parsed.sessions || {})) {
                const session = {
                    ...emptySession(value.phone || key),
                    ...value,
                };
                // Un archivo de una versión anterior puede no traer estos campos.
                if (!Array.isArray(session.templateTimestamps))
                    session.templateTimestamps = [];
                if (typeof session.backoffUntil !== 'number')
                    session.backoffUntil = 0;
                this.sessions.set(key, session);
            }
            console.log(`📂 [Notif Admin] Estado de ventanas restaurado desde ${this.filePath} (${this.sessions.size} admin(s))`);
        }
        catch (error) {
            console.warn(`⚠️ [Notif Admin] No se pudo leer el estado persistido: ${error.message}`);
        }
    }
    schedulePersist() {
        if (this.persistDisabled || this.persistTimer)
            return;
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this.persistNow();
        }, 1000);
        // No mantener vivo el proceso solo por este timer.
        if (typeof this.persistTimer.unref === 'function')
            this.persistTimer.unref();
    }
    /** Escribe el estado a disco. Público para poder forzarlo en pruebas. */
    persistNow() {
        if (this.persistDisabled)
            return;
        const payload = { version: 1, sessions: {} };
        for (const [key, value] of this.sessions) {
            payload.sessions[key] = value;
        }
        try {
            fs_1.default.mkdirSync(path_1.default.dirname(this.filePath), { recursive: true });
            // Nombre temporal único por proceso: si algún día corren varios workers,
            // el rename sigue siendo atómico y no se entrelazan escrituras.
            const tmpPath = `${this.filePath}.${process.pid}.tmp`;
            fs_1.default.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
            fs_1.default.renameSync(tmpPath, this.filePath);
        }
        catch (error) {
            // Un filesystem de solo lectura no debe tumbar las notificaciones:
            // seguimos funcionando en memoria.
            this.persistDisabled = true;
            console.warn(`⚠️ [Notif Admin] No se pudo persistir el estado (se continúa solo en memoria): ${error.message}`);
        }
    }
}
exports.AdminNotificationSessionStore = AdminNotificationSessionStore;
