"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const quote_followup_routes_1 = __importDefault(require("./quote-followup.routes"));
const test_routes_1 = __importDefault(require("./test.routes"));
const webhook_routes_1 = __importDefault(require("./webhook.routes"));
const files_routes_1 = __importDefault(require("./files.routes"));
const whatsapp_routes_1 = __importDefault(require("./whatsapp.routes"));
const router = (0, express_1.Router)();
router.use('/webhooks', webhook_routes_1.default);
router.use('/test', test_routes_1.default);
router.use('/quotes', quote_followup_routes_1.default);
router.use('/files', files_routes_1.default);
router.use('/whatsapp', whatsapp_routes_1.default);
exports.default = router;
