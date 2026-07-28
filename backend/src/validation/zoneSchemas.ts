import { z } from 'zod';
import { idParam } from './householdSchemas.js';

const zoneNameSchema = z.string().trim().min(1).max(100);

export const zoneParamsSchema = z.object({
  householdId: idParam,
  zoneId: idParam,
});

export const createZoneSchema = z.object({
  name: zoneNameSchema,
  parentZoneId: idParam,
});

export const moveZoneSchema = z.object({
  parentZoneId: idParam,
});

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type MoveZoneInput = z.infer<typeof moveZoneSchema>;
