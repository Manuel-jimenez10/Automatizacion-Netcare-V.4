"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const invoice_reminder_controller_1 = require("../controllers/invoice-reminder.controller");
const router = (0, express_1.Router)();
// GET /api/prefacturas/run-reminders - Ejecutar manualmente recordatorios
router.get('/run-reminders', invoice_reminder_controller_1.InvoiceReminderController.runReminders);
exports.default = router;
