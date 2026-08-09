"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const quote_followup_controller_1 = require("../controllers/quote-followup.controller");
const router = (0, express_1.Router)();
// Ejecutar el ciclo de seguimiento. ?dryRun=true simula sin enviar.
// Se mantiene GET por compatibilidad con los accesos manuales existentes.
router.post('/run-followup', quote_followup_controller_1.QuoteFollowUpController.runFollowUp);
router.get('/run-followup', quote_followup_controller_1.QuoteFollowUpController.runFollowUp);
// Resultado de la última ejecución (manual o por cron)
router.get('/followup-status', quote_followup_controller_1.QuoteFollowUpController.getStatus);
exports.default = router;
