"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const quote_followup_controller_1 = require("../controllers/quote-followup.controller");
const router = (0, express_1.Router)();
// POST /api/quotes/run-followup - Ejecutar manualmente el proceso de seguimiento
router.post('/run-followup', quote_followup_controller_1.QuoteFollowUpController.runFollowUp);
exports.default = router;
