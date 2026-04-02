"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startInvoiceReminderJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const invoice_reminder_service_1 = require("../services/invoice-reminder.service");
/**
 * Cron Job para el recordatorio automático de prefacturas
 * Se ejecuta todos los días a las 11:00 AM (México)
 */
let started = false;
const startInvoiceReminderJob = () => {
    // Patrón Singleton para evitar múltiples inits
    if (started) {
        console.log('⚠️ Job de recordatorio de prefacturas ya iniciado. Ignorando llamada.');
        return;
    }
    started = true;
    console.log('🔧 Configurando job de recordatorios de Prefacturas (11:00 AM)...');
    // Ejecutar todos los días a las 11:00 AM
    node_cron_1.default.schedule('0 11 * * *', async () => {
        console.log(`\n⏰ [${new Date().toISOString()}] Ejecutando job programado de recordatorio de Prefacturas`);
        try {
            const service = new invoice_reminder_service_1.InvoiceReminderService();
            await service.processReminders();
        }
        catch (error) {
            console.error('❌ Error en el job de recordatorio de Prefacturas:', error.message);
            console.error(error.stack);
        }
    }, {
        timezone: 'America/Mexico_City' // Horario México solicitado
    });
    console.log('✅ Job de recordatorios de prefacturas configurado (se ejecutará diariamente a las 11:00 AM hora de México)');
};
exports.startInvoiceReminderJob = startInvoiceReminderJob;
