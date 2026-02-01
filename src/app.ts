import express, { Application } from 'express';
import routes from './routes';

const app: Application = express();

// Trust proxy - Required for cPanel/Passenger environment
app.set('trust proxy', 1);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔍 DEBUG: Log global para diagnosticar TODAS las requests entrantes
app.use((req, res, next) => {
  console.log(`\n📥 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log(`   Headers: Content-Type=${req.headers['content-type']}, User-Agent=${req.headers['user-agent']?.substring(0, 50)}`);
  if (req.method === 'POST' && Object.keys(req.body).length > 0) {
    console.log(`   Body Keys: ${Object.keys(req.body).join(', ')}`);
  }
  next();
});

// Health check
app.get('/', (_req, res) => {
  res.send('API running');
});

// Configuración de rutas
// Para compatibilidad con desarrollo local y posibles configuraciones de prefijo en Passenger
app.use('/api', routes);

export default app;
