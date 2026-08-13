import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { choreSchedules, choreZones, chores, households } from '../db/schema.js';
import type { RecurrenceType } from '../db/schema.js';
import {
  ChoreNotFoundError,
  ChoreScheduleManagedByZonesError,
  ChoreZoneMismatchError,
} from '../errors.js';
import { requireHeadMembership, requireMembership } from './membershipAuth.js';
import { computeInitialNextRunAt, fromLocalDateTime, toLocalDateTime } from './scheduleTime.js';
import type { ScheduleRecurrence } from './scheduleTime.js';
import type { SetScheduleInput } from '../validation/scheduleSchemas.js';

export interface ScheduleSummary {
  recurrenceType: RecurrenceType;
  startDate: string;
  startTime: string;
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null;
  intervalMonths: number | null;
  nextRunAt: number | null;
}

export interface ScheduleWithTarget extends ScheduleSummary {
  choreId: number;
  zoneId: number | null;
}

type ScheduleRow = typeof choreSchedules.$inferSelect;

function toSummary(row: ScheduleRow, timeZone: string): ScheduleSummary {
  const local = toLocalDateTime(row.startAt, timeZone);
  const startDate = `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const startTime = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
  return {
    recurrenceType: row.recurrenceType,
    startDate,
    startTime,
    intervalDays: row.intervalDays,
    intervalWeeks: row.intervalWeeks,
    weekdays: row.weekdays ? (JSON.parse(row.weekdays) as number[]) : null,
    intervalMonths: row.intervalMonths,
    nextRunAt: row.nextRunAt,
  };
}

function getHouseholdTimezone(householdId: number): string {
  const row = db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, householdId))
    .get();
  return row?.timezone ?? 'UTC';
}

function findChoreInHousehold(householdId: number, choreId: number) {
  return db
    .select({ id: chores.id })
    .from(chores)
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
    .get();
}

function choreHasAnyZoneLink(choreId: number): boolean {
  return (
    db
      .select({ id: choreZones.id })
      .from(choreZones)
      .where(eq(choreZones.choreId, choreId))
      .get() !== undefined
  );
}

// Builds the recurrence-specific column values from validated input. dayOfMonth is
// derived from startDate here (not accepted from the client — see scheduleSchemas.ts)
// so it can never disagree with the date the user actually picked.
function buildRowValues(input: SetScheduleInput) {
  switch (input.recurrenceType) {
    case 'once':
      return {
        recurrenceType: 'once' as const,
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
      };
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
        dayOfMonth: Number(input.startDate.split('-')[2]),
      };
  }
}

function toRecurrence(
  startAt: number,
  values: ReturnType<typeof buildRowValues>,
): ScheduleRecurrence {
  return {
    startAt,
    recurrenceType: values.recurrenceType,
    intervalDays: values.intervalDays,
    intervalWeeks: values.intervalWeeks,
    weekdays: values.weekdays ? (JSON.parse(values.weekdays) as number[]) : null,
    intervalMonths: values.intervalMonths,
    dayOfMonth: values.dayOfMonth,
  };
}

function insertSchedule(
  target: { choreId: number; choreZoneId: null } | { choreId: null; choreZoneId: number },
  input: SetScheduleInput,
  timeZone: string,
): ScheduleSummary {
  // Both split()+map(Number) results are cast to fixed-length tuples rather than left
  // as number[] — noUncheckedIndexedAccess (tsconfig.json) would otherwise widen each
  // destructured element to `number | undefined`, even though startDate/startTime are
  // already regex-validated (scheduleSchemas.ts) to always have exactly this shape.
  const [year, month, day] = input.startDate.split('-').map(Number) as [number, number, number];
  const [hour, minute] = input.startTime.split(':').map(Number) as [number, number];
  const startAt = fromLocalDateTime({ year, month, day, hour, minute }, timeZone);

  const values = buildRowValues(input);
  const recurrence = toRecurrence(startAt, values);
  const nextRunAt = computeInitialNextRunAt(recurrence, timeZone, Date.now());

  const row = db.transaction((tx) => {
    if (target.choreId !== null) {
      tx.delete(choreSchedules).where(eq(choreSchedules.choreId, target.choreId)).run();
    } else {
      tx.delete(choreSchedules).where(eq(choreSchedules.choreZoneId, target.choreZoneId)).run();
    }
    return tx
      .insert(choreSchedules)
      .values({ ...target, startAt, ...values, nextRunAt, createdAt: Date.now() })
      .returning()
      .get();
  });

  return toSummary(row, timeZone);
}

export function setScheduleForChore(
  householdId: number,
  choreId: number,
  requestingUserId: number,
  input: SetScheduleInput,
): ScheduleSummary {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();
  if (choreHasAnyZoneLink(choreId)) throw new ChoreScheduleManagedByZonesError();

  return insertSchedule({ choreId, choreZoneId: null }, input, getHouseholdTimezone(householdId));
}

export function removeScheduleForChore(
  householdId: number,
  choreId: number,
  requestingUserId: number,
): void {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  db.delete(choreSchedules).where(eq(choreSchedules.choreId, choreId)).run();
}

export function setScheduleForChoreZone(
  householdId: number,
  choreId: number,
  zoneId: number,
  requestingUserId: number,
  input: SetScheduleInput,
): ScheduleSummary {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const link = db
    .select({ id: choreZones.id })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link) throw new ChoreZoneMismatchError();

  return insertSchedule(
    { choreId: null, choreZoneId: link.id },
    input,
    getHouseholdTimezone(householdId),
  );
}

export function removeScheduleForChoreZone(
  householdId: number,
  choreId: number,
  zoneId: number,
  requestingUserId: number,
): void {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const link = db
    .select({ id: choreZones.id })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link) throw new ChoreZoneMismatchError();

  db.delete(choreSchedules).where(eq(choreSchedules.choreZoneId, link.id)).run();
}

// Any member can view — same as chores/zones themselves. Fetched as one flat list
// (own-chore schedules unioned with zone-link schedules) rather than attached to each
// chore, since a household's total schedule count is small and this keeps
// choreService.ts's read path untouched.
export function listSchedulesForHousehold(
  householdId: number,
  requestingUserId: number,
): ScheduleWithTarget[] {
  requireMembership(householdId, requestingUserId);
  const timeZone = getHouseholdTimezone(householdId);

  const ownChoreRows = db
    .select({ schedule: choreSchedules, choreId: chores.id })
    .from(choreSchedules)
    .innerJoin(chores, eq(chores.id, choreSchedules.choreId))
    .where(eq(chores.householdId, householdId))
    .all();

  const zoneLinkRows = db
    .select({ schedule: choreSchedules, choreId: choreZones.choreId, zoneId: choreZones.zoneId })
    .from(choreSchedules)
    .innerJoin(choreZones, eq(choreZones.id, choreSchedules.choreZoneId))
    .innerJoin(chores, eq(chores.id, choreZones.choreId))
    .where(eq(chores.householdId, householdId))
    .all();

  return [
    ...ownChoreRows.map((row) => ({
      ...toSummary(row.schedule, timeZone),
      choreId: row.choreId,
      zoneId: null,
    })),
    ...zoneLinkRows.map((row) => ({
      ...toSummary(row.schedule, timeZone),
      choreId: row.choreId,
      zoneId: row.zoneId,
    })),
  ];
}
