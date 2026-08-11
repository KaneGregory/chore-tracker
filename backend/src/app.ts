import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.js';
import { householdsRouter } from './routes/households.js';
import { zonesRouter } from './routes/zones.js';
import { choresRouter } from './routes/chores.js';
import { pushRouter } from './routes/push.js';
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

  // Unauthenticated liveness check for the hosting platform (e.g. Render) to poll —
  // deliberately does nothing beyond confirming the process is up and responding.
  app.get('/health', (_req, res) => {
    res.status(200).send('ok');
  });

  app.use('/api/auth', authRouter);
  app.use('/api/households', householdsRouter);
  app.use('/api/households', zonesRouter);
  app.use('/api/households', choresRouter);
  app.use('/api/push', pushRouter);

  app.use(errorHandler);

  return app;
}
