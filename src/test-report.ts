import axios from 'axios';
import dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const BASE_URL = process.env.ESPOCRM_BASE_URL || 'https://nc.salesontop.com';
const API_KEY = process.env.ESPOCRM_API_KEY || '';
const headers = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

async function main() {
  try {
    const r = await axios.get(`${BASE_URL}/api/v1/metadata/entities/WhatsappMessage`, { headers });
    fs.writeFileSync('test-metadata.json', JSON.stringify(r.data, null, 2));
    console.log('Success!');
  } catch (e: any) {
    console.error('Error:', e.response?.status, e.message);
  }
}

main();
