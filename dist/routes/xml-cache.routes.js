"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const xml_pending_store_1 = require("../services/xml-pending-store");
const router = (0, express_1.Router)();
/**
 * Endpoint ultra-rápido para servir XMLs cacheados en memoria.
 * Twilio tiene un timeout de ~2 segundos para descargar media.
 * Esta ruta sirve desde memoria (0ms de latencia) en vez de
 * proxear a EspoCRM (que puede tardar >2s).
 *
 * URL: GET /api/xml-cache/:token
 */
router.get('/:token', (req, res) => {
    const { token } = req.params;
    console.log(`⚡ [XML Cache] Solicitud para token: ${token}`);
    console.log(`⚡ [XML Cache] User-Agent: ${req.get('User-Agent')}`);
    const cached = xml_pending_store_1.xmlPendingStore.getByToken(token);
    if (!cached) {
        console.log(`❌ [XML Cache] Token no encontrado o expirado: ${token}`);
        res.status(404).json({ error: 'Archivo no encontrado o expirado' });
        return;
    }
    console.log(`⚡ [XML Cache] Sirviendo: ${cached.fileName} (${cached.buffer.length} bytes) — desde memoria`);
    // Servir como application/octet-stream
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', cached.buffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${cached.fileName}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(cached.buffer);
});
exports.default = router;
