import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.js';
import { householdsRouter } from './routes/households.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin) {
    // The cors package treats a falsy `origin` as `*`, which combined with
    // `credentials: true` is a fail-open misconfiguration. Fail loudly instead.
    throw new Error('CORS_ORIGIN must be set');
  }

  const app = express();

  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10kb' }));

  app.use('/api/auth', authRouter);
  app.use('/api/households', householdsRouter);

  app.use(errorHandler);

  return app;
}
