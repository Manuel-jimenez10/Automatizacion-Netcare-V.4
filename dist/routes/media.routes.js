"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const media_controller_1 = require("../controllers/media.controller");
const router = (0, express_1.Router)();
// Configurar multer para memoria (buffer)
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 16 * 1024 * 1024, // 16MB máximo (límite Twilio)
    }
});
// POST /api/media/upload - Subir archivo
router.post('/upload', upload.single('file'), media_controller_1.MediaController.uploadMedia);
// GET /api/media/proxy/:id - Proxy para servir archivos privados de EspoCRM a Twilio
router.get('/proxy/:id', media_controller_1.MediaController.proxyMedia);
// POST /api/media/send - Enviar media por WhatsApp
// POST /api/media/send - Enviar media por WhatsApp
router.post('/send', media_controller_1.MediaController.sendMedia);
exports.default = router;
