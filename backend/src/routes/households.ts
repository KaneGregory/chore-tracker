import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import {
  createMemberSchema,
  householdParamsSchema,
  memberParamsSchema,
} from '../validation/householdSchemas.js';
import * as householdService from '../services/householdService.js';

export const householdsRouter = Router();

householdsRouter.use(requireAuth);

householdsRouter.get('/:householdId/members', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = householdParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household id', parsed.error.issues));
    return;
  }

  try {
    const members = householdService.getMembersForRequester(parsed.data.householdId, req.user.id);
    res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
});

householdsRouter.post('/:householdId/members', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = householdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = createMemberSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid member details', bodyParsed.error.issues));
    return;
  }

  try {
    const members = householdService.createMember(
      paramsParsed.data.householdId,
      req.user.id,
      bodyParsed.data.username,
    );
    res.status(201).json({ members });
  } catch (err) {
    next(err);
  }
});

householdsRouter.post('/:householdId/members/:userId/promote', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = memberParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household or member id', parsed.error.issues));
    return;
  }

  try {
    const members = householdService.promoteMember(
      parsed.data.householdId,
      req.user.id,
      parsed.data.userId,
    );
    res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
});

householdsRouter.post('/:householdId/members/:userId/demote', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = memberParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household or member id', parsed.error.issues));
    return;
  }

  try {
    const members = householdService.demoteMember(
      parsed.data.householdId,
      req.user.id,
      parsed.data.userId,
    );
    res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
});
