"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
require("./config/env");
const quote_followup_job_1 = require("./jobs/quote-followup.job");
const PORT = process.env.PORT || 3000;
app_1.default.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    // Iniciar cron job de seguimiento de Quotes
    (0, quote_followup_job_1.startQuoteFollowUpJob)();
});
