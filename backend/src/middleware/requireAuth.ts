import type { NextFunction, Request, Response } from 'express';
import { getSessionUser, type PublicHousehold, type PublicUser } from '../services/authService.js';
import { NotAuthenticatedError } from '../errors.js';
import { SESSION_COOKIE_NAME } from '../constants.js';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
      households?: PublicHousehold[];
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token: unknown = req.cookies[SESSION_COOKIE_NAME];
  if (typeof token !== 'string') {
    next(new NotAuthenticatedError());
    return;
  }

  const session = getSessionUser(token);
  if (!session) {
    next(new NotAuthenticatedError());
    return;
  }

  req.user = session.user;
  req.households = session.households;
  next();
}
