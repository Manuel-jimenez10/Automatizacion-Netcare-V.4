"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const whatsapp_init_controller_1 = require("../controllers/whatsapp-init.controller");
const router = (0, express_1.Router)();
// POST /api/whatsapp-init/send - Workflow de EspoCRM envía el contactId
router.post('/send', whatsapp_init_controller_1.WhatsappInitController.handleInit);
exports.default = router;
