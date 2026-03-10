"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractAndValidatePhone = extractAndValidatePhone;
/**
 * Extrae y valida el número de teléfono de un contacto de EspoCRM.
 * Incluye normalización de LADA México (+52) para números que no la tienen.
 *
 * Reglas de validación:
 * 1. Ya empieza con +52 y tiene 13+ dígitos → Dejarlo como está
 * 2. Empieza con 52 (sin +) y tiene 12+ dígitos → Agregar solo +
 * 3. Tiene exactamente 10 dígitos (sin código de país) → Agregar +52
 * 4. Menos de 10 dígitos → Inválido
 * 5. Ya tiene + pero NO es +52 → Dejarlo como está (otro país)
 */
function extractAndValidatePhone(entity) {
    console.log('🔍 Buscando número de teléfono en el contacto...');
    // Posibles campos donde puede estar el teléfono
    const phoneFields = ['phoneNumber', 'phoneMobile', 'phoneOffice', 'phone'];
    let phone;
    // Buscar el primer campo con un valor
    for (const field of phoneFields) {
        if (entity[field]) {
            phone = entity[field];
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
    // Obtener solo los dígitos para análisis
    const digitsOnly = cleanedPhone.replace(/\D/g, '');
    console.log(`   📊 Número limpio: "${cleanedPhone}" | Dígitos: ${digitsOnly.length}`);
    // --- NORMALIZACIÓN DE LADA MÉXICO (+52) ---
    if (cleanedPhone.startsWith('+52') && digitsOnly.length >= 12) {
        // Caso 1: Ya tiene +52 y tiene 12+ dígitos (13+ contando el formato completo)
        // Ejemplo: +525512345678 → dejarlo como está
        console.log(`   ✓ Número ya tiene LADA México (+52). Dígitos: ${digitsOnly.length}. OK.`);
    }
    else if (cleanedPhone.startsWith('+') && !cleanedPhone.startsWith('+52')) {
        // Caso 5: Tiene + pero NO es +52 → asumir otro país, dejarlo como está
        console.log(`   ✓ Número tiene código de país diferente a +52. Se deja como está.`);
    }
    else if (!cleanedPhone.startsWith('+') && digitsOnly.startsWith('52') && digitsOnly.length >= 12) {
        // Caso 2: Empieza con 52 (sin +) y tiene 12+ dígitos → solo agregar +
        // Ejemplo: 525512345678 → +525512345678
        cleanedPhone = `+${digitsOnly}`;
        console.log(`   🔧 Número empieza con 52 sin +. Se agregó +. Resultado: ${cleanedPhone}`);
    }
    else if (digitsOnly.length === 10) {
        // Caso 3: Tiene exactamente 10 dígitos → agregar +52
        // Ejemplo: 5512345678 → +525512345678
        cleanedPhone = `+52${digitsOnly}`;
        console.log(`   🔧 Número de 10 dígitos sin LADA. Se agregó +52. Resultado: ${cleanedPhone}`);
    }
    else if (digitsOnly.length < 10) {
        // Caso 4: Menos de 10 dígitos → inválido
        return {
            isValid: false,
            error: `El número de teléfono es muy corto: ${cleanedPhone} (solo ${digitsOnly.length} dígitos, se requieren mínimo 10)`,
        };
    }
    else {
        // Caso genérico: tiene más de 10 dígitos pero no empieza con 52
        // Agregar + si no lo tiene
        if (!cleanedPhone.startsWith('+')) {
            cleanedPhone = `+${cleanedPhone}`;
        }
        console.log(`   ✓ Número con ${digitsOnly.length} dígitos. Resultado: ${cleanedPhone}`);
    }
    console.log(`   ✅ Número final validado: ${cleanedPhone}`);
    return {
        isValid: true,
        formattedNumber: cleanedPhone,
    };
}
