"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const whatsapp_controller_1 = require("../controllers/whatsapp.controller");
const router = (0, express_1.Router)();
// Twilio Webhook (Incoming Messages)
router.post('/incoming', whatsapp_controller_1.WhatsappController.handleIncomingMessage);
// EspoCRM Webhook (Outgoing Messages - Workflow Trigger)
router.post('/outgoing', whatsapp_controller_1.WhatsappController.handleOutgoingMessage);
// Twilio Status Callback
router.post('/status', whatsapp_controller_1.WhatsappController.handleStatusUpdate);
exports.default = router;
