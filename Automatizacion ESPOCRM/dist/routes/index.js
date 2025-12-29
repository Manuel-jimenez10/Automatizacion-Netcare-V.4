"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const webhook_routes_1 = __importDefault(require("./webhook.routes"));
const test_routes_1 = __importDefault(require("./test.routes"));
const quote_followup_routes_1 = __importDefault(require("./quote-followup.routes"));
const router = (0, express_1.Router)();
router.use('/webhooks', webhook_routes_1.default);
router.use('/test', test_routes_1.default); // 🧪 Rutas de prueba
router.use('/quotes', quote_followup_routes_1.default); // 📋 Rutas de seguimiento de Quotes
exports.default = router;
