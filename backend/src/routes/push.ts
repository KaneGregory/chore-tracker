import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import { pushSubscriptionSchema, unsubscribeSchema } from '../validation/pushSchemas.js';
import * as pushService from '../services/pushService.js';

export const pushRouter = Router();

pushRouter.use(requireAuth);

pushRouter.get('/public-key', (_req, res) => {
  res.status(200).json({ publicKey: pushService.getPublicKey() });
});

pushRouter.post('/subscribe', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = pushSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Invalid push subscription', parsed.error.issues));
    return;
  }

  try {
    pushService.saveSubscription(req.user.id, parsed.data);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

pushRouter.post('/unsubscribe', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Invalid endpoint', parsed.error.issues));
    return;
  }

  try {
    pushService.removeSubscription(req.user.id, parsed.data.endpoint);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
