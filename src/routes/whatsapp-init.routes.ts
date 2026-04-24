import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { WhatsappInitController } from '../controllers/whatsapp-init.controller';

const router = Router();
const upload = multer();

// Middleware que aplica multer SOLO para multipart/form-data
// y deja pasar JSON sin modificar req.body
const parseBody = (req: Request, res: Response, next: NextFunction) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    // EspoCRM a veces envía como multipart
    upload.none()(req, res, next);
  } else {
    // JSON u otro formato - express.json() ya lo parseó en app.ts
    next();
  }
};

// POST /api/whatsapp-init/send
router.post('/send', parseBody, WhatsappInitController.handleInit);

export default router;
