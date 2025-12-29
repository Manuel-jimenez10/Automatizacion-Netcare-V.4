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
exports.QuoteFollowUpService = void 0;
const espocrm_api_client_service_1 = require("./espocrm-api-client.service");
const twilio_service_1 = require("./twilio.service");
const env_1 = require("../config/env");
class QuoteFollowUpService {
    constructor() {
        this.espoCRMClient = new espocrm_api_client_service_1.EspoCRMClient();
    }
    /**
     * Proceso principal: Busca y procesa Quotes que necesitan seguimiento
     * - Status: 'Presented'
     * - Fecha de presentación: >= 7 días atrás
     * - No notificadas previamente (followUpSentAt = null)
     */
    processQuoteFollowUps() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('\n🚀 ============================================');
            console.log('🚀 Iniciando proceso de seguimiento de Quotes');
            console.log('🚀 ============================================\n');
            try {
                // 1. Calcular fecha límite (7 días atrás)
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                const dateLimitStr = sevenDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD
                console.log(`📅 Buscando Quotes presentadas antes de: ${dateLimitStr}`);
                // 2. Construir filtros para la búsqueda
                const whereFilters = [
                    {
                        type: 'and',
                        value: [
                            {
                                type: 'equals',
                                attribute: 'status',
                                value: 'Presented',
                            },
                            // {
                            //   type: 'before',
                            //   attribute: 'datePresented',
                            //   value: dateLimitStr,
                            // },
                            // {
                            //   type: 'isNull',
                            //   attribute: 'followUpSentAt',
                            // },
                        ],
                    },
                ];
                // 3. Buscar Quotes que cumplen los criterios
                const quotes = yield this.espoCRMClient.searchEntities('Quote', whereFilters);
                if (quotes.length === 0) {
                    console.log('ℹ️  No se encontraron Quotes que necesiten seguimiento');
                    console.log('\n✅ ============================================');
                    console.log('✅ Proceso completado (0 Quotes procesadas)');
                    console.log('✅ ============================================\n');
                    return;
                }
                console.log(`\n📊 Se encontraron ${quotes.length} Quote(s) para procesar\n`);
                // 4. Procesar cada Quote individualmente
                let successCount = 0;
                let errorCount = 0;
                for (const quote of quotes) {
                    try {
                        yield this.processQuote(quote);
                        successCount++;
                    }
                    catch (error) {
                        console.error(`❌ Error procesando Quote ${quote.id}:`, error.message);
                        errorCount++;
                        // Continuar con la siguiente Quote (no detener todo el proceso)
                    }
                }
                // 5. Resumen final
                console.log('\n📊 ============================================');
                console.log('📊 RESUMEN DEL PROCESO');
                console.log('📊 ============================================');
                console.log(`   Total Quotes encontradas: ${quotes.length}`);
                console.log(`   ✅ Procesadas exitosamente: ${successCount}`);
                console.log(`   ❌ Con errores: ${errorCount}`);
                console.log('📊 ============================================\n');
            }
            catch (error) {
                console.log('\n❌ ============================================');
                console.log(`❌ Error crítico en el proceso: ${error.message}`);
                console.log('❌ ============================================\n');
                throw error;
            }
        });
    }
    /**
     * Procesa una Quote individual:
     * 1. Obtiene Account asociado
     * 2. Obtiene Billing Contact del Account
     * 3. Extrae y valida teléfono
     * 4. Envía mensaje de WhatsApp
     * 5. Marca Quote como notificada
     */
    processQuote(quote) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📋 Procesando Quote: "${quote.name}" (ID: ${quote.id})`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            // 1. Validar que tiene Account asociado
            if (!quote.accountId) {
                throw new Error('Quote no tiene Account asociado (accountId faltante)');
            }
            console.log(`🔗 Account ID: ${quote.accountId}`);
            // 2. Obtener Account
            const account = yield this.espoCRMClient.getAccount(quote.accountId);
            // 3. Extraer y validar teléfono desde la CUENTA (ACCOUNT)
            // El usuario especificó que el teléfono debe venir del campo "Phone" de la Account
            const phoneValidation = this.extractAndValidatePhone(account);
            if (!phoneValidation.isValid) {
                throw new Error(`Account "${account.name}" no tiene un teléfono válido: ${phoneValidation.error}`);
            }
            console.log(`📞 Teléfono válido (desde Account): ${phoneValidation.formattedNumber}`);
            // 4. Obtener nombre del cliente (Usando nombre de la Cuenta directamente)
            // Se eliminó la lógica de Billing Contact según requerimiento del usuario
            const clientName = account.name;
            console.log(`👤 Cliente final: ${clientName}`);
            // --- SEGURIDAD: MODO DE PRUEBA ---
            if (env_1.env.testPhoneNumber) {
                const safeNumber = env_1.env.testPhoneNumber.replace(/[\s\-\(\)]/g, '');
                const currentNumber = phoneValidation.formattedNumber;
                // Normalizar para comparación (asegurar que ambos tengan o no +)
                const safe = safeNumber.startsWith('+') ? safeNumber : `+${safeNumber}`;
                const current = currentNumber.startsWith('+') ? currentNumber : `+${currentNumber}`;
                if (safe !== current) {
                    console.log(`🛡️ [MODO SEGURO] Saltando envío. El número ${current} no coincide con el número de prueba ${safe}`);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                    return;
                }
                console.log('🛡️ [MODO SEGURO] Número autorizado. Procediendo con el envío.');
            }
            // ---------------------------------
            // 7. Enviar mensaje de WhatsApp
            console.log('📱 Enviando mensaje de seguimiento...');
            yield (0, twilio_service_1.sendQuoteFollowUpMessage)({
                phone: phoneValidation.formattedNumber,
                clientName: clientName,
                quoteName: quote.name,
            });
            // 8. Marcar Quote como notificada
            const now = new Date().toISOString();
            console.log('📝 (TEST MODE) Saltando actualización de followUpSentAt...');
            // await this.espoCRMClient.updateEntity('Quote', quote.id, {
            //   followUpSentAt: now,
            // });
            console.log(`✅ Quote "${quote.name}" procesada exitosamente`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        });
    }
    /**
     * Extrae y valida el número de teléfono de un contacto
     * Reutiliza la misma lógica del servicio de Tasks
     */
    extractAndValidatePhone(entity) {
        console.log('🔍 Buscando número de teléfono en el contacto...');
        // Posibles campos donde puede estar el teléfono
        const phoneFields = ['phoneNumber', 'phoneMobile', 'phoneOffice', 'phone'];
        let phone;
        let fieldFound;
        // Buscar el primer campo con un valor
        for (const field of phoneFields) {
            if (entity[field]) {
                phone = entity[field];
                fieldFound = field;
                console.log(`   ✓ Teléfono encontrado en campo: ${field}`);
                break;
            }
        }
        // Validar que se encontró un teléfono
        if (!phone) {
            return {
                isValid: false,
                error: `No se encontró número de teléfono. Campos revisados: ${phoneFields.join(', ')}`,
            };
        }
        // Limpiar el número (quitar espacios, guiones, paréntesis)
        let cleanedPhone = phone.replace(/[\s\-\(\)]/g, '');
        // Validar que no esté vacío después de limpiar
        if (!cleanedPhone) {
            return {
                isValid: false,
                error: 'El número de teléfono está vacío después de limpiarlo',
            };
        }
        // Asegurar que tenga código de país (+)
        if (!cleanedPhone.startsWith('+')) {
            cleanedPhone = `+${cleanedPhone}`;
        }
        // Validar longitud mínima (al menos 10 dígitos sin contar el +)
        const digitsOnly = cleanedPhone.replace(/\D/g, '');
        if (digitsOnly.length < 10) {
            return {
                isValid: false,
                error: `El número de teléfono es muy corto: ${cleanedPhone} (solo ${digitsOnly.length} dígitos)`,
            };
        }
        console.log(`   ✓ Número limpiado y validado: ${cleanedPhone}`);
        return {
            isValid: true,
            formattedNumber: cleanedPhone,
        };
    }
    /**
     * Obtiene el nombre del cliente
     * Reutiliza la misma lógica del servicio de Tasks
     */
    getClientName(entity) {
        // Si tiene campo "name", usarlo directamente
        if (entity.name) {
            return entity.name;
        }
        // Si tiene firstName y lastName, combinarlos
        if (entity.firstName || entity.lastName) {
            const firstName = entity.firstName || '';
            const lastName = entity.lastName || '';
            return `${firstName} ${lastName}`.trim();
        }
        // Fallback: usar el ID de la entidad
        return entity.id || 'Cliente';
    }
}
exports.QuoteFollowUpService = QuoteFollowUpService;
