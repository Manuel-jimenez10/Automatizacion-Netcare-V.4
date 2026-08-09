"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteFollowUpController = void 0;
const quote_followup_service_1 = require("../services/quote-followup.service");
const env_1 = require("../config/env");
/**
 * Estado del proceso a nivel de módulo.
 *
 * El seguimiento dispara WhatsApp masivos: dos ejecuciones solapadas leerían
 * el mismo contador y enviarían el mismo template dos veces. El candado lo
 * impide dentro del proceso (con varias instancias haría falta un lock
 * compartido, pero el despliegue es de instancia única).
 */
let running = false;
let runningSince = 0;
let lastRun = null;
let lastError = null;
/**
 * Caducidad del candado: si una petición al CRM se queda colgada (el cliente
 * axios no tiene timeout), el candado sin caducidad detendría el seguimiento
 * para siempre y nadie se enteraría.
 */
const LOCK_MAX_AGE_MS = 60 * 60 * 1000;
const lockIsHeld = () => {
    if (!running)
        return false;
    if (Date.now() - runningSince > LOCK_MAX_AGE_MS) {
        console.warn('⚠️ El candado de seguimiento llevaba más de 1 h tomado. Se libera por caducidad.');
        running = false;
        return false;
    }
    return true;
};
/**
 * Interpreta el parámetro de simulación de forma conservadora: cualquier valor
 * que no sea explícitamente "false" cuenta como simulación. Con una
 * comparación estricta, una errata como `?dryRun=1` lanzaría la campaña real.
 */
const parseDryRun = (raw) => {
    if (raw === undefined || raw === null || raw === '')
        return false;
    if (typeof raw === 'boolean')
        return raw;
    return !['false', '0', 'no', 'off'].includes(String(raw).trim().toLowerCase());
};
const secretIsValid = (req) => {
    if (!env_1.env.quoteFollowUpRequireSecret)
        return true;
    const provided = req.headers['x-webhook-secret'] || (req.body && req.body.secret) || '';
    return !!provided && provided === env_1.env.internalWebhookSecret;
};
class QuoteFollowUpController {
    /**
     * Ejecuta el ciclo de seguimiento.
     * POST /api/quotes/run-followup   (GET sigue disponible por compatibilidad)
     *
     * Responde 202 y procesa en segundo plano: con cientos de cotizaciones el
     * proceso tarda minutos y cualquier proxy cortaría la conexión, provocando
     * que el operador reintente y se dupliquen envíos.
     *
     * Parámetros: ?dryRun=true para simular sin enviar nada.
     */
    static runFollowUp(req, res) {
        if (!secretIsValid(req)) {
            res.status(401).json({ success: false, message: 'Secreto inválido o ausente' });
            return;
        }
        const dryRun = parseDryRun(req.query.dryRun ?? req.body?.dryRun);
        // La simulación no escribe ni envía: no debe bloquear al cron de las 09:00.
        if (!dryRun && lockIsHeld()) {
            res.status(409).json({
                success: false,
                message: 'Ya hay un proceso de seguimiento en curso',
                statusUrl: '/api/quotes/followup-status',
            });
            return;
        }
        if (!dryRun) {
            running = true;
            runningSince = Date.now();
        }
        const startedAt = new Date().toISOString();
        console.log(`🔧 Seguimiento de cotizaciones lanzado manualmente${dryRun ? ' (simulación)' : ''}`);
        res.status(202).json({
            success: true,
            message: dryRun
                ? 'Simulación en curso: no se enviará ningún mensaje'
                : 'Proceso de seguimiento en curso',
            dryRun,
            statusUrl: '/api/quotes/followup-status',
            timestamp: startedAt,
        });
        const service = new quote_followup_service_1.QuoteFollowUpService();
        service
            .processQuoteFollowUps({ dryRun })
            .then(result => {
            lastRun = { ...result, startedAt, finishedAt: new Date().toISOString() };
            lastError = null;
        })
            .catch((error) => {
            console.error('❌ Error en el proceso de seguimiento:', error.message);
            lastError = { message: error.message, at: new Date().toISOString() };
        })
            .finally(() => {
            if (!dryRun)
                running = false;
        });
    }
    /**
     * Resultado de la última ejecución (manual o por cron).
     * GET /api/quotes/followup-status
     */
    static getStatus(req, res) {
        if (!secretIsValid(req)) {
            res.status(401).json({ success: false, message: 'Secreto inválido o ausente' });
            return;
        }
        res.status(200).json({
            success: true,
            data: { running, lastRun, lastError },
            timestamp: new Date().toISOString(),
        });
    }
    /** Permite al cron reflejar su resultado en /followup-status. */
    static recordCronRun(result, startedAt) {
        lastRun = { ...result, startedAt, finishedAt: new Date().toISOString() };
        lastError = null;
    }
    static recordCronError(message) {
        lastError = { message, at: new Date().toISOString() };
    }
    /** El cron y el endpoint comparten candado. */
    static tryAcquire() {
        if (lockIsHeld())
            return false;
        running = true;
        runningSince = Date.now();
        return true;
    }
    static release() {
        running = false;
    }
}
exports.QuoteFollowUpController = QuoteFollowUpController;
