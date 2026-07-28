import { z } from 'zod';

const idParam = z.coerce.number().int().positive();

export const householdParamsSchema = z.object({
  householdId: idParam,
});

export const promoteParamsSchema = z.object({
  householdId: idParam,
  userId: idParam,
});
