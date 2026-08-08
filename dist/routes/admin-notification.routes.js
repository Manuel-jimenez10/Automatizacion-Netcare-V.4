"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const admin_notification_controller_1 = require("../controllers/admin-notification.controller");
const router = (0, express_1.Router)();
// Workflow de EspoCRM: se creó un WhatsappMessage entrante
router.post('/whatsapp-message', admin_notification_controller_1.AdminNotificationController.handleCrmMessage);
// StatusCallback de Twilio para las notificaciones internas (sin secreto:
// lo llama Twilio y solo escribe en el log)
router.post('/status-callback', admin_notification_controller_1.AdminNotificationController.handleStatusCallback);
// Diagnóstico y mantenimiento
router.get('/status', admin_notification_controller_1.AdminNotificationController.getStatus);
router.post('/test', admin_notification_controller_1.AdminNotificationController.handleTest);
router.post('/reset', admin_notification_controller_1.AdminNotificationController.handleReset);
exports.default = router;
