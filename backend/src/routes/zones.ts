import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import { householdParamsSchema } from '../validation/householdSchemas.js';
import { createZoneSchema, moveZoneSchema, zoneParamsSchema } from '../validation/zoneSchemas.js';
import * as zoneService from '../services/zoneService.js';

export const zonesRouter = Router();

zonesRouter.use(requireAuth);

zonesRouter.get('/:householdId/zones', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = householdParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household id', parsed.error.issues));
    return;
  }

  try {
    const root = zoneService.getZoneTreeForRequester(parsed.data.householdId, req.user.id);
    res.status(200).json({ root });
  } catch (err) {
    next(err);
  }
});

zonesRouter.post('/:householdId/zones', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = householdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = createZoneSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid zone details', bodyParsed.error.issues));
    return;
  }

  try {
    const root = zoneService.createZone(
      paramsParsed.data.householdId,
      req.user.id,
      bodyParsed.data.name,
      bodyParsed.data.parentZoneId,
    );
    res.status(201).json({ root });
  } catch (err) {
    next(err);
  }
});

zonesRouter.delete('/:householdId/zones/:zoneId', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = zoneParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household or zone id', parsed.error.issues));
    return;
  }

  try {
    const root = zoneService.removeZone(parsed.data.householdId, req.user.id, parsed.data.zoneId);
    res.status(200).json({ root });
  } catch (err) {
    next(err);
  }
});

zonesRouter.patch('/:householdId/zones/:zoneId', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = zoneParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household or zone id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = moveZoneSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid new parent zone', bodyParsed.error.issues));
    return;
  }

  try {
    const root = zoneService.moveZone(
      paramsParsed.data.householdId,
      req.user.id,
      paramsParsed.data.zoneId,
      bodyParsed.data.parentZoneId,
    );
    res.status(200).json({ root });
  } catch (err) {
    next(err);
  }
});
