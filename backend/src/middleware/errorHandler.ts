import type { ErrorRequestHandler } from 'express';
import { AppError, ValidationError } from '../errors.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ValidationError) {
    res
      .status(err.statusCode)
      .json({ error: err.code, message: err.message, details: err.details });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'InternalError', message: 'Something went wrong' });
};
