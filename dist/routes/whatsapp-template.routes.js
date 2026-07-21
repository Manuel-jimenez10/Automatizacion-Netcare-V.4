"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const whatsapp_template_controller_1 = require("../controllers/whatsapp-template.controller");
const router = (0, express_1.Router)();
// POST /api/templates/send - Workflow de EspoCRM envía el ID del registro por POST
router.post('/send', whatsapp_template_controller_1.WhatsappTemplateController.handleSend);
// Flujo alternativo: no usa reporte, recorre todos los Contact con campo phone.
router.post('/send-all-contacts', whatsapp_template_controller_1.WhatsappTemplateController.handleSendAllContacts);
// Consulta de progreso del envio asincrono.
router.get('/jobs/:jobId', whatsapp_template_controller_1.WhatsappTemplateController.handleGetBulkJob);
exports.default = router;
