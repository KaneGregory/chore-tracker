import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { scheduleTemplates } from '../db/schema.js';
import type { ScheduleTemplateRecurrenceType } from '../db/schema.js';
import { ScheduleTemplateNotFoundError } from '../errors.js';
import { requireHeadMembership, requireMembership } from './membershipAuth.js';
import type { CreateScheduleTemplateInput } from '../validation/scheduleTemplateSchemas.js';
import type { OverdueAfterUnit } from './scheduleTime.js';

export interface ScheduleTemplate {
  id: number;
  name: string;
  recurrenceType: ScheduleTemplateRecurrenceType;
  startTime: string;
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null;
  intervalMonths: number | null;
  dayOfMonth: number | null;
  overdueAfter: { amount: number; unit: OverdueAfterUnit } | null;
}

type ScheduleTemplateRow = typeof scheduleTemplates.$inferSelect;

function toSummary(row: ScheduleTemplateRow): ScheduleTemplate {
  return {
    id: row.id,
    name: row.name,
    recurrenceType: row.recurrenceType,
    startTime: row.startTime,
    intervalDays: row.intervalDays,
    intervalWeeks: row.intervalWeeks,
    weekdays: row.weekdays ? (JSON.parse(row.weekdays) as number[]) : null,
    intervalMonths: row.intervalMonths,
    dayOfMonth: row.dayOfMonth,
    overdueAfter:
      row.overdueAfterAmount !== null && row.overdueAfterUnit !== null
        ? { amount: row.overdueAfterAmount, unit: row.overdueAfterUnit }
        : null,
  };
}

// Mirrors scheduleService.ts's buildRowValues — one recurrence-shaped column set per
// type, everything else null.
function buildRowValues(input: CreateScheduleTemplateInput) {
  switch (input.recurrenceType) {
    case 'every_n_days':
      return {
        recurrenceType: 'every_n_days' as const,
        intervalDays: input.intervalDays,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
      };
    case 'weekly':
      return {
        recurrenceType: 'weekly' as const,
        intervalDays: null,
        intervalWeeks: input.intervalWeeks,
        weekdays: JSON.stringify([...new Set(input.weekdays)].sort((a, b) => a - b)),
        intervalMonths: null,
        dayOfMonth: null,
      };
    case 'monthly':
      return {
        recurrenceType: 'monthly' as const,
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: input.intervalMonths,
        dayOfMonth: input.dayOfMonth,
      };
  }
}

function findScheduleTemplateInHousehold(
  householdId: number,
  scheduleTemplateId: number,
): ScheduleTemplateRow | undefined {
  return db
    .select()
    .from(scheduleTemplates)
    .where(and(eq(scheduleTemplates.id, scheduleTemplateId), eq(scheduleTemplates.householdId, householdId)))
    .get();
}

export function listScheduleTemplatesForHousehold(
  householdId: number,
  requestingUserId: number,
): ScheduleTemplate[] {
  requireMembership(householdId, requestingUserId);
  return db
    .select()
    .from(scheduleTemplates)
    .where(eq(scheduleTemplates.householdId, householdId))
    .all()
    .map(toSummary);
}

export function createScheduleTemplate(
  householdId: number,
  requestingUserId: number,
  input: CreateScheduleTemplateInput,
): ScheduleTemplate {
  requireHeadMembership(householdId, requestingUserId);

  const values = buildRowValues(input);
  const row = db
    .insert(scheduleTemplates)
    .values({
      householdId,
      name: input.name,
      startTime: input.startTime,
      ...values,
      overdueAfterAmount: input.overdueAfter?.amount ?? null,
      overdueAfterUnit: input.overdueAfter?.unit ?? null,
      createdAt: Date.now(),
    })
    .returning()
    .get();

  return toSummary(row);
}

export function removeScheduleTemplate(
  householdId: number,
  requestingUserId: number,
  scheduleTemplateId: number,
): void {
  requireHeadMembership(householdId, requestingUserId);

  if (!findScheduleTemplateInHousehold(householdId, scheduleTemplateId)) {
    throw new ScheduleTemplateNotFoundError();
  }

  db.delete(scheduleTemplates).where(eq(scheduleTemplates.id, scheduleTemplateId)).run();
}
