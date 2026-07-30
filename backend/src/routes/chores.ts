import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import { householdParamsSchema } from '../validation/householdSchemas.js';
import {
  assignChoreSchema,
  assignmentParamsSchema,
  choreParamsSchema,
  createChoreSchema,
} from '../validation/choreSchemas.js';
import * as choreService from '../services/choreService.js';

export const choresRouter = Router();

choresRouter.use(requireAuth);

choresRouter.get('/:householdId/chores', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = householdParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household id', parsed.error.issues));
    return;
  }

  try {
    const chores = choreService.listChoresForRequester(parsed.data.householdId, req.user.id);
    res.status(200).json({ chores });
  } catch (err) {
    next(err);
  }
});

choresRouter.post('/:householdId/chores', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = householdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = createChoreSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid chore details', bodyParsed.error.issues));
    return;
  }

  try {
    const chore = choreService.createChore(
      paramsParsed.data.householdId,
      req.user.id,
      bodyParsed.data.name,
      bodyParsed.data.type,
      bodyParsed.data.zoneIds,
    );
    res.status(201).json({ chore });
  } catch (err) {
    next(err);
  }
});

choresRouter.post('/:householdId/chores/:choreId/assignments', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = choreParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household or chore id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = assignChoreSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid assignment details', bodyParsed.error.issues));
    return;
  }

  try {
    const chore = choreService.assignChore(
      paramsParsed.data.householdId,
      paramsParsed.data.choreId,
      req.user.id,
      bodyParsed.data.userId,
      bodyParsed.data.zoneId,
    );
    res.status(201).json({ chore });
  } catch (err) {
    next(err);
  }
});

choresRouter.delete('/:householdId/chores/:choreId/assignments/:assignmentId', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = assignmentParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid ids', paramsParsed.error.issues));
    return;
  }

  try {
    const chore = choreService.unassignChore(
      paramsParsed.data.householdId,
      paramsParsed.data.choreId,
      req.user.id,
      paramsParsed.data.assignmentId,
    );
    res.status(200).json({ chore });
  } catch (err) {
    next(err);
  }
});
