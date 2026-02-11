import { Router } from 'express';
import multer from 'multer';
import { MediaController } from '../controllers/media.controller';

const router = Router();

// Configurar multer para memoria (buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 16 * 1024 * 1024, // 16MB máximo (límite Twilio)
  }
});

// POST /api/media/upload - Subir archivo
router.post('/upload', upload.single('file'), MediaController.uploadMedia);

// GET /api/media/proxy/:id - Proxy para servir archivos privados de EspoCRM a Twilio
router.get('/proxy/:id', MediaController.proxyMedia);

// POST /api/media/send - Enviar media por WhatsApp

// POST /api/media/send - Enviar media por WhatsApp
router.post('/send', MediaController.sendMedia);

export default router;
