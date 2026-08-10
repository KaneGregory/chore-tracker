import { z } from 'zod';
import { usernameSchema } from './authSchemas.js';

export const idParam = z.coerce.number().int().positive();

export const householdParamsSchema = z.object({
  householdId: idParam,
});

// Shared by both the promote and demote member-action routes — same shape either way.
export const memberParamsSchema = z.object({
  householdId: idParam,
  userId: idParam,
});

export const createMemberSchema = z.object({
  username: usernameSchema,
});
