"use strict";
/**
 * Conversión de HTML a texto plano apto para WhatsApp.
 *
 * Los campos Wysiwyg de EspoCRM guardan HTML (`<p>Hola<br>mundo</p>`), no
 * texto. Enviarlo tal cual haría que el cliente viera las etiquetas.
 *
 * WhatsApp no entiende HTML, pero sí tiene su propio formato:
 *   *negrita*   _cursiva_   ~tachado~
 * así que el formato que el agente aplique en el editor se traduce en vez de
 * perderse.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.htmlToWhatsappText = exports.decodeHtmlEntities = void 0;
const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    hellip: '…', mdash: '—', ndash: '–', bull: '•', middot: '·',
    laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',
    deg: '°', euro: '€', pound: '£', cent: '¢', copy: '©', reg: '®',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
};
/** Etiquetas que delatan que el contenido es HTML de verdad. */
const LOOKS_LIKE_HTML = /<\/?(p|div|br|span|strong|b|em|i|u|s|del|ul|ol|li|h[1-6]|a|table|tbody|tr|td|blockquote|pre|code)\b[^>]*\/?>/i;
const fromCodePoint = (code) => {
    try {
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    }
    catch {
        return '';
    }
};
/** Convierte `&amp;`, `&#241;`, `&#x1F600;`… en sus caracteres reales. */
const decodeHtmlEntities = (text) => text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name] ?? match);
exports.decodeHtmlEntities = decodeHtmlEntities;
/**
 * HTML de un campo Wysiwyg → texto listo para enviar por WhatsApp.
 *
 * Si el contenido no parece HTML se deja intacto (solo se decodifican las
 * entidades): así un texto como "precio < 100 > 50" no se rompe.
 */
const htmlToWhatsappText = (html) => {
    if (!html)
        return '';
    let text = String(html).replace(/\r\n?/g, '\n');
    if (LOOKS_LIKE_HTML.test(text)) {
        text = text
            // Bloques sin contenido visible
            .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
            // Formato propio de WhatsApp (antes de borrar las etiquetas)
            .replace(/<\s*(strong|b)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '*$2*')
            .replace(/<\s*(em|i)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '_$2_')
            .replace(/<\s*(s|del|strike)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '~$2~')
            // Listas
            .replace(/<\s*li\b[^>]*>/gi, '\n• ')
            .replace(/<\s*\/\s*li\s*>/gi, '')
            // Saltos de línea
            .replace(/<\s*br\s*\/?\s*>/gi, '\n')
            // `ul`/`ol` incluidos: sin ellos, el último ítem se pega al párrafo
            // siguiente ("• Configuración de la appCualquier duda...").
            .replace(/<\s*\/\s*(p|div|h[1-6]|tr|blockquote|pre|ul|ol)\s*>/gi, '\n')
            // Cualquier otra etiqueta desaparece
            .replace(/<[^>]+>/g, '');
    }
    text = (0, exports.decodeHtmlEntities)(text);
    return text
        // El espacio duro de los editores cuenta como espacio consecutivo para Meta
        .replace(/ /g, ' ')
        .split('\n')
        .map(line => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        // Un editor genera párrafos vacíos con facilidad; no queremos huecos enormes
        .replace(/\n{3,}/g, '\n\n')
        // Una lista pegada a su párrafo introductorio se lee mejor sin hueco
        .replace(/\n\n(?=• )/g, '\n')
        .trim();
};
exports.htmlToWhatsappText = htmlToWhatsappText;
