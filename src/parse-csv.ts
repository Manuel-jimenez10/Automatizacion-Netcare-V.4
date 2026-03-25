import * as fs from 'fs';

try {
  const jsonContent = fs.readFileSync('test-results.json', 'utf8');
  const results = JSON.parse(jsonContent);
  const csvContent = results.step3_csv_content;
  
  if (!csvContent) {
    console.log("No CSV content found in test results.");
    process.exit(1);
  }
  
  const lines = csvContent.split('\n').filter((l: string) => l.trim() !== '');
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
  
} catch (e: any) {
  console.log("Error:", e.message);
}
