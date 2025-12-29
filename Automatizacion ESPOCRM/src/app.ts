import express, { Application } from 'express';
import routes from './routes';

const app: Application = express();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rutas
app.use('/api', routes);

// Health check
app.get('/', (_req, res) => {
  res.send('API running');
});

export default app;
