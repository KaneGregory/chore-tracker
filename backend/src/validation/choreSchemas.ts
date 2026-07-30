import { z } from 'zod';
import { idParam } from './householdSchemas.js';
import { CHORE_TYPES } from '../db/schema.js';

const choreNameSchema = z.string().trim().min(1).max(100);

export const createChoreSchema = z.object({
  name: choreNameSchema,
  type: z.enum(CHORE_TYPES),
  zoneIds: z.array(idParam).default([]),
});

export type CreateChoreInput = z.infer<typeof createChoreSchema>;

export const choreParamsSchema = z.object({
  householdId: idParam,
  choreId: idParam,
});

export const assignChoreSchema = z.object({
  userId: idParam,
  zoneId: idParam
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

export type AssignChoreInput = z.infer<typeof assignChoreSchema>;

export const assignmentParamsSchema = z.object({
  householdId: idParam,
  choreId: idParam,
  assignmentId: idParam,
});
