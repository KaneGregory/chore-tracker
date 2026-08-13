import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import { householdChoiceSchema } from '../validation/authSchemas.js';
import {
  assignPendingMemberSchema,
  createMemberSchema,
  householdParamsSchema,
  memberParamsSchema,
  setHouseholdTimezoneSchema,
} from '../validation/householdSchemas.js';
import * as householdService from '../services/householdService.js';
import * as authService from '../services/authService.js';

export const householdsRouter = Router();

householdsRouter.use(requireAuth);

householdsRouter.post('/', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = householdChoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new ValidationError('Invalid household details', parsed.error.issues));
    return;
  }

  try {
    const household = authService.addHouseholdForExistingUser(req.user.id, parsed.data);
    res.status(201).json({ household });
  } catch (err) {
    next(err);
  }
});

householdsRouter.patch('/:householdId/timezone', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = householdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = setHouseholdTimezoneSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid timezone', bodyParsed.error.issues));
    return;
  }

  try {
    householdService.setTimezone(paramsParsed.data.householdId, req.user.id, bodyParsed.data.timezone);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

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

householdsRouter.post('/:householdId/members/:userId/approve', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = memberParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household or member id', parsed.error.issues));
    return;
  }

  try {
    const members = householdService.approveMember(
      parsed.data.householdId,
      req.user.id,
      parsed.data.userId,
    );
    res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
});

householdsRouter.post('/:householdId/members/:userId/decline', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = memberParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household or member id', parsed.error.issues));
    return;
  }

  try {
    const members = householdService.declineMember(
      parsed.data.householdId,
      req.user.id,
      parsed.data.userId,
    );
    res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
});

householdsRouter.post('/:householdId/members/:userId/assign', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = memberParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household or member id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = assignPendingMemberSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid assignment target', bodyParsed.error.issues));
    return;
  }

  try {
    const members = householdService.assignPendingMember(
      paramsParsed.data.householdId,
      req.user.id,
      paramsParsed.data.userId,
      bodyParsed.data.targetMemberId,
    );
    res.status(200).json({ members });
  } catch (err) {
    next(err);
  }
});
