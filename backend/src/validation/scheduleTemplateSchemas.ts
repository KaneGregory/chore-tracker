import { z } from 'zod';
import { startTimeSchema, weekdaySchema } from './scheduleSchemas.js';
import { idParam } from './householdSchemas.js';

const scheduleTemplateNameSchema = z.string().trim().min(1).max(60);

const everyNDaysScheduleTemplateSchema = z.object({
  recurrenceType: z.literal('every_n_days'),
  name: scheduleTemplateNameSchema,
  startTime: startTimeSchema,
  intervalDays: z.number().int().min(1).max(365),
});

const weeklyScheduleTemplateSchema = z.object({
  recurrenceType: z.literal('weekly'),
  name: scheduleTemplateNameSchema,
  startTime: startTimeSchema,
  intervalWeeks: z.number().int().min(1).max(52),
  weekdays: z.array(weekdaySchema).min(1).max(7),
});

// dayOfMonth is a required client-supplied field here — unlike setScheduleSchema's
// monthly variant, a schedule template has no startDate to derive it from (see
// schema.ts's comment on scheduleTemplates).
const monthlyScheduleTemplateSchema = z.object({
  recurrenceType: z.literal('monthly'),
  name: scheduleTemplateNameSchema,
  startTime: startTimeSchema,
  intervalMonths: z.number().int().min(1).max(24),
  dayOfMonth: z.number().int().min(1).max(31),
});

export const createScheduleTemplateSchema = z.discriminatedUnion('recurrenceType', [
  everyNDaysScheduleTemplateSchema,
  weeklyScheduleTemplateSchema,
  monthlyScheduleTemplateSchema,
]);

export type CreateScheduleTemplateInput = z.infer<typeof createScheduleTemplateSchema>;

export const scheduleTemplateParamsSchema = z.object({
  householdId: idParam,
  scheduleTemplateId: idParam,
});
