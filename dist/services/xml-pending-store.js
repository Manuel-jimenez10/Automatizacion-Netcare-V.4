"use strict";
/**
 * Almacén en memoria para XMLs pendientes de entrega.
 *
 * Incluye CACHE de los archivos (buffers) para servir instantáneamente
 * cuando Twilio los solicita (evitar timeout de ~2s de Twilio).
 *
 * TTL: 72 horas (se auto-limpia).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.xmlPendingStore = void 0;
const crypto_1 = __importDefault(require("crypto"));
const TTL_MS = 72 * 60 * 60 * 1000; // 72 horas
const pendingXmlMap = new Map();
// Cache rápido: token → buffer (para servir sin latencia)
const tokenCache = new Map();
/**
 * Normaliza el teléfono a solo dígitos para consistencia en el Map.
 */
const normalizePhone = (phone) => {
    return phone.replace(/\D/g, '');
};
/**
 * Genera un token único para una URL de cache.
 */
const generateToken = () => {
    return crypto_1.default.randomBytes(16).toString('hex');
};
exports.xmlPendingStore = {
    /**
     * Guarda XML(s) pendiente(s) con sus buffers pre-descargados.
     */
    set(phone, files, invoiceName) {
        const key = normalizePhone(phone);
        // Generar tokens y cachear cada archivo
        const cachedFiles = files.map(f => {
            const token = generateToken();
            tokenCache.set(token, { buffer: f.buffer, fileName: f.fileName });
            return { buffer: f.buffer, fileName: f.fileName, token };
        });
        pendingXmlMap.set(key, {
            cachedFiles,
            invoiceName,
            phone,
            timestamp: Date.now(),
        });
        console.log(`📦 [XML Store] Guardado XML pendiente para ${key} (${cachedFiles.length} archivo(s), factura: ${invoiceName})`);
        cachedFiles.forEach(f => console.log(`   📄 Token: ${f.token} → ${f.fileName} (${f.buffer.length} bytes)`));
    },
    /**
     * Obtiene los XMLs pendientes para un teléfono.
     */
    get(phone) {
        const key = normalizePhone(phone);
        const data = pendingXmlMap.get(key);
        if (!data)
            return undefined;
        // Verificar TTL
        if (Date.now() - data.timestamp > TTL_MS) {
            console.log(`⏰ [XML Store] XML pendiente para ${key} expiró (TTL 72h). Eliminando...`);
            data.cachedFiles.forEach(f => tokenCache.delete(f.token));
            pendingXmlMap.delete(key);
            return undefined;
        }
        return data;
    },
    /**
     * Obtiene un archivo cacheado por su token (para servir a Twilio instantáneamente).
     */
    getByToken(token) {
        return tokenCache.get(token);
    },
    /**
     * Elimina la entrada pendiente del teléfono (después de enviar el link),
     * pero MANTIENE los tokens en tokenCache para que el usuario pueda
     * acceder al link incluso después de que el bot de Facebook haga preview.
     * Los tokens expiran solos con el TTL de 72h.
     */
    remove(phone) {
        const key = normalizePhone(phone);
        pendingXmlMap.delete(key);
        // NO borrar tokenCache aquí — el usuario aún necesita acceder al link
        console.log(`🗑️ [XML Store] Eliminado XML pendiente para ${key} (tokens de cache mantenidos por TTL)`);
    },
    /**
     * Limpieza periódica de entradas expiradas.
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, data] of pendingXmlMap) {
            if (now - data.timestamp > TTL_MS) {
                data.cachedFiles.forEach(f => tokenCache.delete(f.token));
                pendingXmlMap.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`🧹 [XML Store] Limpieza: ${cleaned} entrada(s) expirada(s) eliminada(s)`);
        }
    },
    size() {
        return pendingXmlMap.size;
    },
};
// Auto-limpieza cada hora
setInterval(() => exports.xmlPendingStore.cleanup(), 60 * 60 * 1000);
