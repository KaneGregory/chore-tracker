import { z } from 'zod';

// Local wall-clock date/time, interpreted against the household's own timezone
// server-side (see scheduleService.ts) — not the browser's timezone, since a
// schedule belongs to the household, not to whoever happens to be setting it.
const startDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const startTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
const weekdaySchema = z.number().int().min(0).max(6);

const onceScheduleSchema = z.object({
  recurrenceType: z.literal('once'),
  startDate: startDateSchema,
  startTime: startTimeSchema,
});

const everyNDaysScheduleSchema = z.object({
  recurrenceType: z.literal('every_n_days'),
  startDate: startDateSchema,
  startTime: startTimeSchema,
  intervalDays: z.number().int().min(1).max(365),
});

const weeklyScheduleSchema = z.object({
  recurrenceType: z.literal('weekly'),
  startDate: startDateSchema,
  startTime: startTimeSchema,
  intervalWeeks: z.number().int().min(1).max(52),
  weekdays: z.array(weekdaySchema).min(1).max(7),
});

// dayOfMonth is deliberately not a client-supplied field — it's derived from
// startDate server-side (see scheduleService.ts), so the two can never disagree.
const monthlyScheduleSchema = z.object({
  recurrenceType: z.literal('monthly'),
  startDate: startDateSchema,
  startTime: startTimeSchema,
  intervalMonths: z.number().int().min(1).max(24),
});

export const setScheduleSchema = z.discriminatedUnion('recurrenceType', [
  onceScheduleSchema,
  everyNDaysScheduleSchema,
  weeklyScheduleSchema,
  monthlyScheduleSchema,
]);

export type SetScheduleInput = z.infer<typeof setScheduleSchema>;
