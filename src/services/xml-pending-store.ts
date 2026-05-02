/**
 * Almacén en memoria para XMLs pendientes de entrega.
 * 
 * Cuando se envía una factura con XML adjunto, el XML se guarda aquí
 * vinculado al teléfono del cliente. Cuando el cliente presiona el botón
 * "Solicitar mi XML", el sistema busca aquí el XML pendiente y lo envía.
 * 
 * TTL: 72 horas (se auto-limpia).
 */

interface PendingXmlData {
  xmlUrls: string[];       // URLs públicas del/los XML(s)
  invoiceName: string;     // Nombre de la factura (para contexto en el mensaje)
  phone: string;           // Teléfono del destinatario
  timestamp: number;       // Marca de tiempo para TTL
}

const TTL_MS = 72 * 60 * 60 * 1000; // 72 horas

const pendingXmlMap = new Map<string, PendingXmlData>();

/**
 * Normaliza el teléfono a solo dígitos para consistencia en el Map.
 */
const normalizePhone = (phone: string): string => {
  return phone.replace(/\D/g, '');
};

export const xmlPendingStore = {

  /**
   * Guarda XML(s) pendiente(s) para un teléfono.
   */
  set(phone: string, xmlUrls: string[], invoiceName: string): void {
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
  get(phone: string): PendingXmlData | undefined {
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
  remove(phone: string): void {
    const key = normalizePhone(phone);
    pendingXmlMap.delete(key);
    console.log(`🗑️ [XML Store] Eliminado XML pendiente para ${key}`);
  },

  /**
   * Limpieza periódica de entradas expiradas.
   */
  cleanup(): void {
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
  size(): number {
    return pendingXmlMap.size;
  },
};

// Auto-limpieza cada hora
setInterval(() => xmlPendingStore.cleanup(), 60 * 60 * 1000);
