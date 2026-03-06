"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const invoice_confirmed_controller_1 = require("../controllers/invoice-confirmed.controller");
const router = (0, express_1.Router)();
// POST /api/invoices/confirmed - Webhook para cuando una Prefactura cambia a Confirmed
router.post('/confirmed', invoice_confirmed_controller_1.InvoiceConfirmedController.handleConfirmed);
exports.default = router;
