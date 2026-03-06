"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const quote_presented_controller_1 = require("../controllers/quote-presented.controller");
const router = (0, express_1.Router)();
// POST /api/quotes/presented - Webhook para cuando una Quote cambia a Presented
router.post('/presented', quote_presented_controller_1.QuotePresentedController.handlePresented);
exports.default = router;
