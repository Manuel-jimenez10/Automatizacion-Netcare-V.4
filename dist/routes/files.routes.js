"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const espocrm_api_client_service_1 = require("../services/espocrm-api-client.service");
const router = (0, express_1.Router)();
const espoClient = new espocrm_api_client_service_1.EspoCRMClient();
router.get('/:id', async (req, res) => {
    const fileId = req.params.id;
    console.log(`🌍 [PROXY] Solicitud entrante para archivo: ${fileId}`);
    console.log(`🌍 [PROXY] User-Agent: ${req.get('User-Agent')}`);
    try {
        const response = await espoClient.getFile(fileId);
        // Set headers from the original response if available, or default to PDF
        // EspoCRM usually sends strict content-types
        const contentType = response.headers['content-type'] || 'application/pdf';
        res.setHeader('Content-Type', contentType);
        // Pipe the stream to the response
        response.data.pipe(res);
    }
    catch (error) {
        console.error(`Error sirviendo archivo ${fileId}:`, error.message);
        res.status(404).json({ error: 'Archivo no encontrado o no accesible' });
    }
});
exports.default = router;
