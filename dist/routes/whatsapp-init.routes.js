"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const whatsapp_init_controller_1 = require("../controllers/whatsapp-init.controller");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)();
// Middleware que aplica multer SOLO para multipart/form-data
// y deja pasar JSON sin modificar req.body
const parseBody = (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data')) {
        // EspoCRM a veces envía como multipart
        upload.none()(req, res, next);
    }
    else {
        // JSON u otro formato - express.json() ya lo parseó en app.ts
        next();
    }
};
// POST /api/whatsapp-init/send
router.post('/send', parseBody, whatsapp_init_controller_1.WhatsappInitController.handleInit);
exports.default = router;
