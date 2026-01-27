"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthService = void 0;
class HealthService {
    getHealth() {
        return {
            message: 'Server is running correctly',
            timestamp: new Date(),
        };
    }
}
exports.HealthService = HealthService;
