"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const test_controller_1 = require("../controllers/test.controller");
const router = (0, express_1.Router)();
// 🧪 Ruta de prueba - NO requiere EspoCRM
router.get('/send-whatsapp', test_controller_1.testWhatsApp);
exports.default = router;
