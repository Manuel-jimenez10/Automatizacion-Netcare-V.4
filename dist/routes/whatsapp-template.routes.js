"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const whatsapp_template_controller_1 = require("../controllers/whatsapp-template.controller");
const router = (0, express_1.Router)();
// POST /api/templates/send - Workflow de EspoCRM envía el ID del registro por POST
router.post('/send', whatsapp_template_controller_1.WhatsappTemplateController.handleSend);
exports.default = router;
