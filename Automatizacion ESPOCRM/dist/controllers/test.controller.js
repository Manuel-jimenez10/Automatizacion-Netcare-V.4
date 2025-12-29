"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testWhatsApp = void 0;
const twilio_service_1 = require("../services/twilio.service");
/**
 * RUTA DE PRUEBA - Solo para testing
 * Envía un WhatsApp con datos hardcodeados sin tocar EspoCRM
 */
const testWhatsApp = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('\n🧪 ============================================');
        console.log('🧪 PRUEBA: Enviando WhatsApp con datos hardcodeados');
        console.log('🧪 ============================================\n');
        // Datos hardcodeados para la prueba
        // IMPORTANTE: Cambia este número por tu número de WhatsApp personal para recibir la prueba
        const testPhone = '+584121292194'; // 👈 CAMBIA ESTE NÚMERO
        const testClientName = 'Juan Pérez (PRUEBA)';
        const testTaskName = 'Revisión de documentos fiscales (PRUEBA)';
        console.log('📱 Número de prueba:', testPhone);
        console.log('👤 Cliente de prueba:', testClientName);
        console.log('📋 Task de prueba:', testTaskName);
        console.log('');
        // Enviar el mensaje de WhatsApp
        yield (0, twilio_service_1.sendTaskCompletedMessage)({
            phone: testPhone,
            clientName: testClientName,
            taskName: testTaskName,
        });
        console.log('\n✅ ============================================');
        console.log('✅ PRUEBA EXITOSA: WhatsApp enviado');
        console.log('✅ ============================================\n');
        return res.status(200).json({
            success: true,
            message: 'WhatsApp de prueba enviado exitosamente',
            data: {
                phone: testPhone,
                clientName: testClientName,
                taskName: testTaskName,
            },
        });
    }
    catch (error) {
        console.error('\n❌ ============================================');
        console.error('❌ ERROR EN PRUEBA:', error.message);
        console.error('❌ ============================================\n');
        return res.status(500).json({
            error: 'Test Failed',
            message: error.message,
            details: error.code || 'No error code available',
        });
    }
});
exports.testWhatsApp = testWhatsApp;
