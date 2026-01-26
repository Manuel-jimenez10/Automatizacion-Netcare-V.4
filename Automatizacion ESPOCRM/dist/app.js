"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const routes_1 = __importDefault(require("./routes"));
const app = (0, express_1.default)();
// Trust proxy - Required for cPanel/Passenger environment
app.set('trust proxy', 1);
// Middlewares
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Health check
app.get('/', (_req, res) => {
    res.send('API running');
});
// Configuración de rutas
// Para compatibilidad con desarrollo local y posibles configuraciones de prefijo en Passenger
app.use('/api', routes_1.default);
exports.default = app;
