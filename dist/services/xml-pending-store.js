"use strict";
/**
 * Almacén en memoria para XMLs pendientes de entrega.
 *
 * Cuando se envía una factura con XML adjunto, el XML se guarda aquí
 * vinculado al teléfono del cliente. Cuando el cliente presiona el botón
 * "Solicitar mi XML", el sistema busca aquí el XML pendiente y lo envía.
 *
 * TTL: 72 horas (se auto-limpia).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.xmlPendingStore = void 0;
const TTL_MS = 72 * 60 * 60 * 1000; // 72 horas
const pendingXmlMap = new Map();
/**
 * Normaliza el teléfono a solo dígitos para consistencia en el Map.
 */
const normalizePhone = (phone) => {
    return phone.replace(/\D/g, '');
};
exports.xmlPendingStore = {
    /**
     * Guarda XML(s) pendiente(s) para un teléfono.
     */
    set(phone, xmlUrls, invoiceName) {
        const key = normalizePhone(phone);
        pendingXmlMap.set(key, {
            xmlUrls,
            invoiceName,
            phone,
            timestamp: Date.now(),
        });
        console.log(`📦 [XML Store] Guardado XML pendiente para ${key} (${xmlUrls.length} archivo(s), factura: ${invoiceName})`);
    },
    /**
     * Obtiene los XMLs pendientes para un teléfono.
     * Retorna undefined si no hay datos o si expiraron (TTL).
     */
    get(phone) {
        const key = normalizePhone(phone);
        const data = pendingXmlMap.get(key);
        if (!data) {
            return undefined;
        }
        // Verificar TTL
        if (Date.now() - data.timestamp > TTL_MS) {
            console.log(`⏰ [XML Store] XML pendiente para ${key} expiró (TTL 72h). Eliminando...`);
            pendingXmlMap.delete(key);
            return undefined;
        }
        return data;
    },
    /**
     * Elimina los XMLs pendientes para un teléfono (después de enviarlos).
     */
    remove(phone) {
        const key = normalizePhone(phone);
        pendingXmlMap.delete(key);
        console.log(`🗑️ [XML Store] Eliminado XML pendiente para ${key}`);
    },
    /**
     * Limpieza periódica de entradas expiradas.
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, data] of pendingXmlMap) {
            if (now - data.timestamp > TTL_MS) {
                pendingXmlMap.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`🧹 [XML Store] Limpieza: ${cleaned} entrada(s) expirada(s) eliminada(s)`);
        }
    },
    /**
     * Cantidad de entradas activas (para diagnóstico).
     */
    size() {
        return pendingXmlMap.size;
    },
};
// Auto-limpieza cada hora
setInterval(() => exports.xmlPendingStore.cleanup(), 60 * 60 * 1000);
