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

import fs from 'fs';
import path from 'path';
import { phoneKey } from '../utils/notification-phone.utils';

export interface AdminSessionState {
  /** Teléfono tal como está configurado (E.164). */
  phone: string;
  /** Epoch ms del último mensaje recibido DEL administrador. 0 = nunca. */
  lastInboundAt: number;
  /** Epoch ms del último template enviado (para el cooldown opcional). */
  lastTemplateAt: number;
  /** Epoch ms de los templates de la última hora (tope anti-spam). */
  templateTimestamps: number[];
  /** Epoch ms hasta el que NO se envían templates (Meta nos frenó). */
  backoffUntil: number;
  /** Contadores acumulados, útiles para diagnóstico. */
  templatesSent: number;
  freeTextSent: number;
}

interface PersistedState {
  version: 1;
  sessions: Record<string, AdminSessionState>;
}

const emptySession = (phone: string): AdminSessionState => ({
  phone,
  lastInboundAt: 0,
  lastTemplateAt: 0,
  templateTimestamps: [],
  backoffUntil: 0,
  templatesSent: 0,
  freeTextSent: 0,
});

const HOUR_MS = 60 * 60 * 1000;

export class AdminNotificationSessionStore {
  private sessions = new Map<string, AdminSessionState>();
  private readonly filePath: string;
  private readonly windowMs: number;
  private persistTimer: NodeJS.Timeout | null = null;
  private persistDisabled = false;

  constructor(options: { filePath?: string; windowHours?: number } = {}) {
    const hours = options.windowHours && options.windowHours > 0 ? options.windowHours : 24;
    this.windowMs = hours * 60 * 60 * 1000;
    this.filePath =
      options.filePath || path.join(process.cwd(), 'data', 'admin-notification-sessions.json');

    this.load();
  }

  // ─────────────────────────────────────────────────────────────
  // Lectura
  // ─────────────────────────────────────────────────────────────

  /** ¿La ventana de 24h de este administrador sigue abierta? */
  isWindowOpen(phone: string): boolean {
    return this.remainingMs(phone) > 0;
  }

  /** Milisegundos que le quedan a la ventana (0 si está cerrada). */
  remainingMs(phone: string): number {
    const session = this.sessions.get(phoneKey(phone));
    if (!session || !session.lastInboundAt) return 0;

    const remaining = session.lastInboundAt + this.windowMs - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /** Epoch ms del último mensaje del administrador (0 si nunca respondió). */
  lastInboundAt(phone: string): number {
    return this.sessions.get(phoneKey(phone))?.lastInboundAt || 0;
  }

  /** Epoch ms del último template enviado a este administrador. */
  lastTemplateAt(phone: string): number {
    return this.sessions.get(phoneKey(phone))?.lastTemplateAt || 0;
  }

  /** Templates enviados a este administrador en la última hora. */
  templatesInLastHour(phone: string): number {
    const session = this.sessions.get(phoneKey(phone));
    if (!session) return 0;

    const cutoff = Date.now() - HOUR_MS;
    session.templateTimestamps = session.templateTimestamps.filter(t => t >= cutoff);
    return session.templateTimestamps.length;
  }

  /** Milisegundos que faltan para que termine el backoff impuesto por Meta. */
  backoffRemainingMs(phone: string): number {
    const until = this.sessions.get(phoneKey(phone))?.backoffUntil || 0;
    const remaining = until - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Frena los templates a este administrador durante un rato. Se usa cuando
   * Twilio/Meta responden con un error de límite o de bloqueo: insistir es
   * justamente lo que degrada la calidad del sender.
   */
  setBackoff(phone: string, durationMs: number): void {
    const session = this.ensure(phone);
    const until = Date.now() + durationMs;
    if (until > session.backoffUntil) {
      session.backoffUntil = until;
      this.schedulePersist();
    }
  }

  /** Estado completo de un administrador (para diagnóstico). */
  get(phone: string): AdminSessionState {
    return this.sessions.get(phoneKey(phone)) || emptySession(phone);
  }

  /** Copia del estado de todos los administradores conocidos. */
  snapshot(): AdminSessionState[] {
    return [...this.sessions.values()].map(s => ({ ...s }));
  }

  // ─────────────────────────────────────────────────────────────
  // Escritura
  // ─────────────────────────────────────────────────────────────

  /**
   * El administrador nos escribió: abre (o reinicia) su ventana de 24h.
   * `timestamp` permite rehidratar desde el historial de Twilio.
   */
  registerInbound(phone: string, timestamp: number = Date.now()): AdminSessionState {
    const session = this.ensure(phone);

    // Nunca retrocedemos la ventana: un dato rehidratado más viejo no debe
    // pisar un mensaje reciente que ya habíamos registrado.
    if (timestamp > session.lastInboundAt) {
      session.lastInboundAt = timestamp;
      this.schedulePersist();
    }

    return session;
  }

  markTemplateSent(phone: string, timestamp: number = Date.now()): void {
    const session = this.ensure(phone);
    session.lastTemplateAt = timestamp;
    session.templatesSent += 1;

    const cutoff = timestamp - HOUR_MS;
    session.templateTimestamps = session.templateTimestamps.filter(t => t >= cutoff);
    session.templateTimestamps.push(timestamp);

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
  reserveTemplateSlot(
    phone: string,
    limits: { cooldownMs?: number; maxPerHour?: number } = {},
  ): { allowed: boolean; reason?: string; retryInMinutes?: number; timestamp?: number } {
    const now = Date.now();

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
    if (maxPerHour > 0 && this.templatesInLastHour(phone) >= maxPerHour) {
      return { allowed: false, reason: 'hourly_cap' };
    }

    this.markTemplateSent(phone, now);
    return { allowed: true, timestamp: now };
  }

  /** Devuelve el cupo reservado cuando el envío acabó fallando. */
  releaseTemplateSlot(phone: string, timestamp?: number): void {
    if (!timestamp) return;

    const session = this.sessions.get(phoneKey(phone));
    if (!session) return;

    const index = session.templateTimestamps.lastIndexOf(timestamp);
    if (index >= 0) session.templateTimestamps.splice(index, 1);

    if (session.templatesSent > 0) session.templatesSent -= 1;
    session.lastTemplateAt = session.templateTimestamps.length
      ? session.templateTimestamps[session.templateTimestamps.length - 1]
      : 0;

    this.schedulePersist();
  }

  markFreeTextSent(phone: string): void {
    const session = this.ensure(phone);
    session.freeTextSent += 1;
    this.schedulePersist();
  }

  /**
   * Cierra la ventana a la fuerza. Se usa cuando Twilio nos responde que el
   * mensaje libre quedó fuera de la ventana: nuestro reloj estaba equivocado.
   */
  closeWindow(phone: string): void {
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
  reset(phone?: string): void {
    const targets = phone ? [phoneKey(phone)] : [...this.sessions.keys()];

    for (const key of targets) {
      const session = this.sessions.get(key);
      if (session) session.lastInboundAt = 0;
    }

    this.schedulePersist();
  }

  // ─────────────────────────────────────────────────────────────
  // Internos
  // ─────────────────────────────────────────────────────────────

  private ensure(phone: string): AdminSessionState {
    const key = phoneKey(phone);
    let session = this.sessions.get(key);

    if (!session) {
      session = emptySession(phone);
      this.sessions.set(key, session);
    } else if (phone && session.phone !== phone) {
      session.phone = phone;
    }

    return session;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedState;

      for (const [key, value] of Object.entries(parsed.sessions || {})) {
        const session: AdminSessionState = {
          ...emptySession(value.phone || key),
          ...value,
        };
        // Un archivo de una versión anterior puede no traer estos campos.
        if (!Array.isArray(session.templateTimestamps)) session.templateTimestamps = [];
        if (typeof session.backoffUntil !== 'number') session.backoffUntil = 0;

        this.sessions.set(key, session);
      }

      console.log(
        `📂 [Notif Admin] Estado de ventanas restaurado desde ${this.filePath} (${this.sessions.size} admin(s))`,
      );
    } catch (error: any) {
      console.warn(`⚠️ [Notif Admin] No se pudo leer el estado persistido: ${error.message}`);
    }
  }

  private schedulePersist(): void {
    if (this.persistDisabled || this.persistTimer) return;

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 1000);

    // No mantener vivo el proceso solo por este timer.
    if (typeof this.persistTimer.unref === 'function') this.persistTimer.unref();
  }

  /** Escribe el estado a disco. Público para poder forzarlo en pruebas. */
  persistNow(): void {
    if (this.persistDisabled) return;

    const payload: PersistedState = { version: 1, sessions: {} };
    for (const [key, value] of this.sessions) {
      payload.sessions[key] = value;
    }

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      // Nombre temporal único por proceso: si algún día corren varios workers,
      // el rename sigue siendo atómico y no se entrelazan escrituras.
      const tmpPath = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (error: any) {
      // Un filesystem de solo lectura no debe tumbar las notificaciones:
      // seguimos funcionando en memoria.
      this.persistDisabled = true;
      console.warn(
        `⚠️ [Notif Admin] No se pudo persistir el estado (se continúa solo en memoria): ${error.message}`,
      );
    }
  }
}
