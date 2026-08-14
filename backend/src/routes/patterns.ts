import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import { householdParamsSchema } from '../validation/householdSchemas.js';
import {
  createPatternSchema,
  patternParamsSchema,
  renamePatternSchema,
} from '../validation/patternSchemas.js';
import * as patternService from '../services/patternService.js';

export const patternsRouter = Router();

patternsRouter.use(requireAuth);

patternsRouter.get('/:householdId/patterns', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = householdParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household id', parsed.error.issues));
    return;
  }

  try {
    const patterns = patternService.listPatternsForHousehold(parsed.data.householdId, req.user.id);
    res.status(200).json({ patterns });
  } catch (err) {
    next(err);
  }
});

patternsRouter.post('/:householdId/patterns', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = householdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = createPatternSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid pattern', bodyParsed.error.issues));
    return;
  }

  try {
    const pattern = patternService.createPattern(
      paramsParsed.data.householdId,
      req.user.id,
      bodyParsed.data,
    );
    res.status(201).json({ pattern });
  } catch (err) {
    next(err);
  }
});

patternsRouter.patch('/:householdId/patterns/:patternId', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = patternParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid ids', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = renamePatternSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid name', bodyParsed.error.issues));
    return;
  }

  try {
    const pattern = patternService.renamePattern(
      paramsParsed.data.householdId,
      req.user.id,
      paramsParsed.data.patternId,
      bodyParsed.data,
    );
    res.status(200).json({ pattern });
  } catch (err) {
    next(err);
  }
});

patternsRouter.delete('/:householdId/patterns/:patternId', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = patternParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid ids', paramsParsed.error.issues));
    return;
  }

  try {
    patternService.removePattern(
      paramsParsed.data.householdId,
      req.user.id,
      paramsParsed.data.patternId,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
