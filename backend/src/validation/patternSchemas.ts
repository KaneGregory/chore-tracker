import { z } from 'zod';
import { startTimeSchema, weekdaySchema } from './scheduleSchemas.js';
import { idParam } from './householdSchemas.js';

const patternNameSchema = z.string().trim().min(1).max(60);

const everyNDaysPatternSchema = z.object({
  recurrenceType: z.literal('every_n_days'),
  name: patternNameSchema,
  startTime: startTimeSchema,
  intervalDays: z.number().int().min(1).max(365),
});

const weeklyPatternSchema = z.object({
  recurrenceType: z.literal('weekly'),
  name: patternNameSchema,
  startTime: startTimeSchema,
  intervalWeeks: z.number().int().min(1).max(52),
  weekdays: z.array(weekdaySchema).min(1).max(7),
});

// dayOfMonth is a required client-supplied field here — unlike setScheduleSchema's
// monthly variant, a pattern has no startDate to derive it from (see schema.ts's
// comment on schedulePatterns).
const monthlyPatternSchema = z.object({
  recurrenceType: z.literal('monthly'),
  name: patternNameSchema,
  startTime: startTimeSchema,
  intervalMonths: z.number().int().min(1).max(24),
  dayOfMonth: z.number().int().min(1).max(31),
});

export const createPatternSchema = z.discriminatedUnion('recurrenceType', [
  everyNDaysPatternSchema,
  weeklyPatternSchema,
  monthlyPatternSchema,
]);

export type CreatePatternInput = z.infer<typeof createPatternSchema>;

export const renamePatternSchema = z.object({
  name: patternNameSchema,
});

export type RenamePatternInput = z.infer<typeof renamePatternSchema>;

export const patternParamsSchema = z.object({
  householdId: idParam,
  patternId: idParam,
});
