"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const app_1 = __importDefault(require("./app"));
const quote_followup_job_1 = require("./jobs/quote-followup.job");
const PORT = process.env.PORT || 3000;
// Este archivo es SOLO para ejecución local o VPS tradicional
// Passenger NO usa este archivo.
app_1.default.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    // Iniciar Cron Jobs
    (0, quote_followup_job_1.startQuoteFollowUpJob)();
});
