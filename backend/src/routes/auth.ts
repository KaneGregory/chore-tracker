import { Router } from 'express';
import { ValidationError, NotAuthenticatedError } from '../errors.js';
import {
  emailAvailabilityQuerySchema,
  loginSchema,
  registerSchema,
  usernameAvailabilityQuerySchema,
} from '../validation/authSchemas.js';
import * as authService from '../services/authService.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '../constants.js';

export const authRouter = Router();

authRouter.get('/email-availability', (req, res, next) => {
  const parsed = emailAvailabilityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Invalid email', parsed.error.issues));
    return;
  }

  const available = authService.isEmailAvailable(parsed.data.email);
  res.status(200).json({ available });
});

authRouter.get('/username-availability', (req, res, next) => {
  const parsed = usernameAvailabilityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    next(new ValidationError('Invalid username', parsed.error.issues));
    return;
  }

  const available = authService.isUsernameAvailable(parsed.data.username);
  res.status(200).json({ available });
});

authRouter.post('/register', async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Invalid registration details', parsed.error.issues));
    return;
  }

  try {
    const result = await authService.register(parsed.data);
    res.cookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(authService.SESSION_TTL_MS));
    res.status(201).json({ user: result.user, households: result.households });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Invalid login details', parsed.error.issues));
    return;
  }

  try {
    const result = await authService.login(parsed.data);
    res.cookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(authService.SESSION_TTL_MS));
    res.status(200).json({ user: result.user, households: result.households });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req, res) => {
  const token: unknown = req.cookies[SESSION_COOKIE_NAME];
  if (typeof token === 'string') {
    authService.logout(token);
  }
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions(authService.SESSION_TTL_MS));
  res.status(204).send();
});

authRouter.get('/me', requireAuth, (req, res) => {
  if (!req.user || !req.households) {
    throw new NotAuthenticatedError();
  }
  res.status(200).json({ user: req.user, households: req.households });
});
