import { z } from 'zod';
import { idParam } from './householdSchemas.js';

const choreNameSchema = z.string().trim().min(1).max(100);

export const createChoreSchema = z.object({
  name: choreNameSchema,
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

// 'overdue' isn't user-settable yet — it'll be computed once due dates exist.
export const settableChoreStatusSchema = z.enum(['to-do', 'complete']);

export const setChoreStatusSchema = z.object({
  status: settableChoreStatusSchema,
});

export type SetChoreStatusInput = z.infer<typeof setChoreStatusSchema>;

export const choreZoneParamsSchema = z.object({
  householdId: idParam,
  choreId: idParam,
  zoneId: idParam,
});
