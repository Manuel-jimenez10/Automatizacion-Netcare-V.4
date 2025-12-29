"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const healthService_1 = require("../services/healthService");
class HealthController {
    constructor() {
        this.getHealth = (req, res) => {
            const status = this.healthService.getHealth();
            res.json(status);
        };
        this.healthService = new healthService_1.HealthService();
    }
}
exports.HealthController = HealthController;
