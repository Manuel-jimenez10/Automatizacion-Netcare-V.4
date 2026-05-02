import { Router, Request, Response } from 'express';
import { EspoCRMClient } from '../services/espocrm-api-client.service';

const router = Router();
const espoClient = new EspoCRMClient();

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const fileId = req.params.id;

  console.log(`🌍 [PROXY] Solicitud entrante para archivo: ${fileId}`);
  console.log(`🌍 [PROXY] User-Agent: ${req.get('User-Agent')}`);

  try {
    // Usar getFileAsBuffer (más robusto que streaming para Twilio)
    const response = await espoClient.getFileAsBuffer(fileId);
    
    const buffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    
    // Extraer filename del header Content-Disposition si EspoCRM lo envía
    let fileName = `file_${fileId}`;
    const disposition = response.headers['content-disposition'];
    if (disposition) {
      const match = disposition.match(/filename[^;=\n]*=(?:.*''|"?)([^";\n]*)/i);
      if (match && match[1]) {
        fileName = match[1];
      }
    }

    console.log(`🌍 [PROXY] Sirviendo: ${fileName} (${contentType}, ${buffer.length} bytes)`);

    // Headers que Twilio necesita para descargar exitosamente
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    res.send(buffer);
  } catch (error: any) {
    console.error(`Error sirviendo archivo ${fileId}:`, error.message);
    res.status(404).json({ error: 'Archivo no encontrado o no accesible' });
  }
});

export default router;
