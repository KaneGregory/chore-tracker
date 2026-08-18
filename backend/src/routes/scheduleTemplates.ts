import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import { householdParamsSchema } from '../validation/householdSchemas.js';
import {
  createScheduleTemplateSchema,
  scheduleTemplateParamsSchema,
} from '../validation/scheduleTemplateSchemas.js';
import * as scheduleTemplateService from '../services/scheduleTemplateService.js';

export const scheduleTemplatesRouter = Router();

scheduleTemplatesRouter.use(requireAuth);

scheduleTemplatesRouter.get('/:householdId/schedule-templates', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = householdParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household id', parsed.error.issues));
    return;
  }

  try {
    const scheduleTemplates = scheduleTemplateService.listScheduleTemplatesForHousehold(
      parsed.data.householdId,
      req.user.id,
    );
    res.status(200).json({ scheduleTemplates });
  } catch (err) {
    next(err);
  }
});

scheduleTemplatesRouter.post('/:householdId/schedule-templates', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = householdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = createScheduleTemplateSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid schedule template', bodyParsed.error.issues));
    return;
  }

  try {
    const scheduleTemplate = scheduleTemplateService.createScheduleTemplate(
      paramsParsed.data.householdId,
      req.user.id,
      bodyParsed.data,
    );
    res.status(201).json({ scheduleTemplate });
  } catch (err) {
    next(err);
  }
});

scheduleTemplatesRouter.delete('/:householdId/schedule-templates/:scheduleTemplateId', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = scheduleTemplateParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid ids', paramsParsed.error.issues));
    return;
  }

  try {
    scheduleTemplateService.removeScheduleTemplate(
      paramsParsed.data.householdId,
      req.user.id,
      paramsParsed.data.scheduleTemplateId,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
