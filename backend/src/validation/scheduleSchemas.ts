import { z } from 'zod';

// Local wall-clock date/time, interpreted against the household's own timezone
// server-side (see scheduleService.ts) — not the browser's timezone, since a
// schedule belongs to the household, not to whoever happens to be setting it.
// Rejects a syntactically-YYYY-MM-DD string that isn't a real calendar date (e.g.
// 2026-02-30) and one with an absurd year — both otherwise pass the bare regex and
// reach computeInitialNextRunAt/advanceUntilFuture (scheduleTime.ts), whose catch-up
// loop steps forward one cycle at a time: a year like 0001 with a daily interval is
// ~739,000 iterations, tens of seconds of blocked event loop from one request. See
// the "unbounded catch-up loop" finding this fixed.
function isReasonableStartDate(value: string): boolean {
  // Non-null assertions are safe here: the schema's .regex check above already
  // guarantees exactly three numeric YYYY/MM/DD parts before this refine ever runs.
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  const currentYear = new Date().getUTCFullYear();
  return year >= currentYear - 1 && year <= currentYear + 50;
}

const startDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine(isReasonableStartDate, 'Start date must be a real calendar date, not more than a year in the past');
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
