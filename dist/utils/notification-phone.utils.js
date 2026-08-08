"use strict";
/**
 * Utilidades de teléfonos para las notificaciones a administradores.
 *
 * Twilio/WhatsApp no siempre entrega el mismo formato para un mismo número
 * (sobre todo en México, donde conviven +521XXXXXXXXXX y +52XXXXXXXXXX),
 * así que todas las comparaciones se hacen sobre una clave canónica.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeTemplateVariable = exports.maskPhone = exports.parsePhoneList = exports.phoneVariants = exports.isSamePhone = exports.phoneKey = exports.toDigits = void 0;
/** Extrae solo los dígitos y quita el prefijo internacional 00. */
const toDigits = (phone) => (phone || '').replace(/\D/g, '').replace(/^00/, '');
exports.toDigits = toDigits;
/**
 * Clave canónica de un teléfono para comparaciones.
 * México: WhatsApp a veces entrega +521XXXXXXXXXX y otras +52XXXXXXXXXX
 * para el mismo número. Normalizamos quitando ese "1" heredado.
 */
const phoneKey = (phone) => {
    const digits = (0, exports.toDigits)(phone);
    if (digits.startsWith('521') && digits.length === 13) {
        return `52${digits.slice(3)}`;
    }
    return digits;
};
exports.phoneKey = phoneKey;
/**
 * Compara dos teléfonos tolerando el "1" heredado de México.
 *
 * Deliberadamente NO comparamos "los últimos 10 dígitos": un administrador
 * venezolano (+58 412 129 2194, número nacional de 9 dígitos) colisionaría con
 * cualquier celular mexicano 412 129 2194. Un falso positivo aquí haría que el
 * mensaje de un CLIENTE se tratara como respuesta de administrador y se
 * descartara sin registrarse en el CRM.
 */
const isSamePhone = (a, b) => {
    const keyA = (0, exports.phoneKey)(a);
    const keyB = (0, exports.phoneKey)(b);
    return !!keyA && keyA === keyB;
};
exports.isSamePhone = isSamePhone;
/**
 * Variantes de un número mexicano con y sin el "1" posterior al +52.
 * Se usa al consultar el historial de Twilio, que guarda el número
 * exactamente como llegó.
 */
const phoneVariants = (phone) => {
    const digits = (0, exports.toDigits)(phone);
    if (!digits)
        return [];
    const variants = new Set([`+${digits}`]);
    if (digits.startsWith('521') && digits.length === 13) {
        variants.add(`+52${digits.slice(3)}`);
    }
    else if (digits.startsWith('52') && digits.length === 12) {
        variants.add(`+521${digits.slice(2)}`);
    }
    return [...variants];
};
exports.phoneVariants = phoneVariants;
/**
 * Convierte "a, b; c" (o saltos de línea) en una lista de teléfonos E.164 únicos.
 * Descarta entradas con menos de 10 dígitos.
 */
const parsePhoneList = (raw) => {
    if (!raw)
        return [];
    const seen = new Set();
    const list = [];
    for (const part of raw.split(/[,;|\n\r]+/)) {
        const digits = (0, exports.toDigits)(part.trim());
        if (digits.length < 10)
            continue;
        const key = (0, exports.phoneKey)(digits);
        if (seen.has(key))
            continue;
        seen.add(key);
        list.push(`+${digits}`);
    }
    return list;
};
exports.parsePhoneList = parsePhoneList;
/** Enmascara un teléfono para logs y respuestas HTTP: +5216******222 */
const maskPhone = (phone) => {
    const digits = (0, exports.toDigits)(phone);
    if (digits.length <= 7)
        return `+${digits}`;
    return `+${digits.slice(0, 4)}${'*'.repeat(digits.length - 7)}${digits.slice(-3)}`;
};
exports.maskPhone = maskPhone;
/**
 * Deja un texto apto para usarse como variable de un template de WhatsApp.
 *
 * Meta rechaza las variables que contienen saltos de línea, tabuladores o más
 * de 4 espacios consecutivos ("Param text cannot have new-line/tab characters
 * or more than 4 consecutive spaces"; Twilio lo suele reportar como 63021).
 * Aplicamos la misma limpieza al texto libre para que el mensaje se vea
 * IDÉNTICO por ambos caminos y el administrador no note la diferencia entre
 * template y texto plano.
 */
const sanitizeTemplateVariable = (value, maxLength = 600) => {
    let clean = (value || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim();
    if (!clean)
        clean = '(sin texto)';
    if (maxLength > 1 && clean.length > maxLength) {
        clean = `${clean.slice(0, maxLength - 1).trimEnd()}…`;
    }
    return clean;
};
exports.sanitizeTemplateVariable = sanitizeTemplateVariable;
