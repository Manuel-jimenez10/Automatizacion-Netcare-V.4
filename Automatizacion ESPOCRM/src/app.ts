import express, { Application } from 'express';
import routes from './routes';

const app: Application = express();

// Trust proxy - Required for cPanel/Passenger environment
app.set('trust proxy', 1);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (_req, res) => {
  res.send('API running');
});

// Configuración de rutas
// Para compatibilidad con desarrollo local y posibles configuraciones de prefijo en Passenger
app.use('/api', routes);

export default app;
