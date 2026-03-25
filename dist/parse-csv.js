"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
try {
    const jsonContent = fs.readFileSync('test-results.json', 'utf8');
    const results = JSON.parse(jsonContent);
    const csvContent = results.step3_csv_content;
    if (!csvContent) {
        console.log("No CSV content found in test results.");
        process.exit(1);
    }
    const lines = csvContent.split('\n').filter((l) => l.trim() !== '');
    console.log(`Encontrados ${lines.length - 1} contactos en el reporte CSV (excluyendo cabecera)`);
    // The header line is the first one
    const headers = lines[0].split(';');
    const nameIdx = headers.indexOf('name');
    const phoneIdx = headers.indexOf('phoneNumber');
    console.log('\n--- CONTACTOS EXTRAÍDOS ---');
    for (let i = 1; i < lines.length; i++) {
        // Basic CSV parsing splitting by ; (ignoring quotes for this simple test)
        // A real implementation would use a proper CSV parser
        const row = lines[i].split(';');
        const name = row[nameIdx]?.replace(/^"|"$/g, '') || '';
        const phone = row[phoneIdx]?.replace(/^'/, '') || ''; // remove leading quote EspoCRM adds to phones
        console.log(`[${i}] CONTACTO: ${name} | TELÉFONO: ${phone || '(Sin teléfono)'}`);
    }
    console.log('---------------------------\n');
}
catch (e) {
    console.log("Error:", e.message);
}
