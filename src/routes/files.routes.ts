import { Router, Request, Response } from 'express';
import { EspoCRMClient } from '../services/espocrm-api-client.service';

const router = Router();
const espoClient = new EspoCRMClient();

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const fileId = req.params.id;

  console.log(`🌍 [PROXY] Solicitud entrante para archivo: ${fileId}`);
  console.log(`🌍 [PROXY] User-Agent: ${req.get('User-Agent')}`);

  try {
    const response = await espoClient.getFile(fileId);
    
    // Set headers from the original response if available, or default to PDF
    // EspoCRM usually sends strict content-types
    const contentType = response.headers['content-type'] || 'application/pdf';
    res.setHeader('Content-Type', contentType);
    
    // Pipe the stream to the response
    response.data.pipe(res);
  } catch (error: any) {
    console.error(`Error sirviendo archivo ${fileId}:`, error.message);
    res.status(404).json({ error: 'Archivo no encontrado o no accesible' });
  }
});

export default router;
