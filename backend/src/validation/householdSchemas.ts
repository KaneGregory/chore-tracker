import { z } from 'zod';
import { usernameSchema } from './authSchemas.js';
import { timeZoneSchema } from './timeZoneSchema.js';

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

export const assignPendingMemberSchema = z.object({
  targetMemberId: idParam,
});

export const setHouseholdTimezoneSchema = z.object({
  timezone: timeZoneSchema,
});
