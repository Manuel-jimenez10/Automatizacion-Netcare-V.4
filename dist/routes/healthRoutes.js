"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const healthController_1 = require("../controllers/healthController");
const router = (0, express_1.Router)();
const healthController = new healthController_1.HealthController();
router.get('/', healthController.getHealth);
exports.default = router;
