import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { schedulePatterns } from '../db/schema.js';
import type { PatternRecurrenceType } from '../db/schema.js';
import { PatternNotFoundError } from '../errors.js';
import { requireHeadMembership, requireMembership } from './membershipAuth.js';
import type { CreatePatternInput, RenamePatternInput } from '../validation/patternSchemas.js';

export interface SchedulePattern {
  id: number;
  name: string;
  recurrenceType: PatternRecurrenceType;
  startTime: string;
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null;
  intervalMonths: number | null;
  dayOfMonth: number | null;
}

type PatternRow = typeof schedulePatterns.$inferSelect;

function toSummary(row: PatternRow): SchedulePattern {
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
  };
}

// Mirrors scheduleService.ts's buildRowValues — one recurrence-shaped column set per
// type, everything else null.
function buildRowValues(input: CreatePatternInput) {
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

function findPatternInHousehold(householdId: number, patternId: number): PatternRow | undefined {
  return db
    .select()
    .from(schedulePatterns)
    .where(and(eq(schedulePatterns.id, patternId), eq(schedulePatterns.householdId, householdId)))
    .get();
}

export function listPatternsForHousehold(
  householdId: number,
  requestingUserId: number,
): SchedulePattern[] {
  requireMembership(householdId, requestingUserId);
  return db
    .select()
    .from(schedulePatterns)
    .where(eq(schedulePatterns.householdId, householdId))
    .all()
    .map(toSummary);
}

export function createPattern(
  householdId: number,
  requestingUserId: number,
  input: CreatePatternInput,
): SchedulePattern {
  requireHeadMembership(householdId, requestingUserId);

  const values = buildRowValues(input);
  const row = db
    .insert(schedulePatterns)
    .values({
      householdId,
      name: input.name,
      startTime: input.startTime,
      ...values,
      createdAt: Date.now(),
    })
    .returning()
    .get();

  return toSummary(row);
}

export function renamePattern(
  householdId: number,
  requestingUserId: number,
  patternId: number,
  input: RenamePatternInput,
): SchedulePattern {
  requireHeadMembership(householdId, requestingUserId);

  if (!findPatternInHousehold(householdId, patternId)) throw new PatternNotFoundError();

  const row = db
    .update(schedulePatterns)
    .set({ name: input.name })
    .where(eq(schedulePatterns.id, patternId))
    .returning()
    .get();

  return toSummary(row);
}

export function removePattern(
  householdId: number,
  requestingUserId: number,
  patternId: number,
): void {
  requireHeadMembership(householdId, requestingUserId);

  if (!findPatternInHousehold(householdId, patternId)) throw new PatternNotFoundError();

  db.delete(schedulePatterns).where(eq(schedulePatterns.id, patternId)).run();
}
