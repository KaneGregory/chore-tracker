import { z } from 'zod';

export const idParam = z.coerce.number().int().positive();

export const householdParamsSchema = z.object({
  householdId: idParam,
});

export const promoteParamsSchema = z.object({
  householdId: idParam,
  userId: idParam,
});
