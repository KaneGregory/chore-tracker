import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { choreSchedules, choreZones, chores, households } from '../db/schema.js';
import { advanceUntilFuture } from './scheduleTime.js';
import type { ScheduleRecurrence } from './scheduleTime.js';
import { systemReopenChore, systemReopenChoreZone } from './choreService.js';

const CHECK_INTERVAL_MS = 60_000;

type ScheduleRow = typeof choreSchedules.$inferSelect;

function toRecurrence(row: ScheduleRow): ScheduleRecurrence {
  return {
    recurrenceType: row.recurrenceType,
    startAt: row.startAt,
    intervalDays: row.intervalDays,
    intervalWeeks: row.intervalWeeks,
    weekdays: row.weekdays ? (JSON.parse(row.weekdays) as number[]) : null,
    intervalMonths: row.intervalMonths,
    dayOfMonth: row.dayOfMonth,
  };
}

// Resolves a schedule row to the {choreId, zoneId} it actually targets — choreId
// directly for a whole-chore schedule, or via a lookup on chore_zones for a
// zone-specific one (see chore_schedules' "exactly one of choreId/choreZoneId" rule
// in schema.ts). Returns null if the target has since been deleted (a race between
// this query and the chore/zone's removal) — the caller skips such a row silently.
function resolveTarget(row: ScheduleRow): { choreId: number; zoneId: number | null } | null {
  if (row.choreId !== null) return { choreId: row.choreId, zoneId: null };
  if (row.choreZoneId === null) return null;
  const link = db
    .select({ choreId: choreZones.choreId, zoneId: choreZones.zoneId })
    .from(choreZones)
    .where(eq(choreZones.id, row.choreZoneId))
    .get();
  return link ?? null;
}

function householdTimezoneForChore(choreId: number): string {
  const chore = db.select({ householdId: chores.householdId }).from(chores).where(eq(chores.id, choreId)).get();
  if (!chore) return 'UTC';
  const household = db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, chore.householdId))
    .get();
  return household?.timezone ?? 'UTC';
}

// Exported (and accepting `now` rather than reading Date.now() internally) so it's
// directly testable — same rationale as dailyReminderScheduler.ts's
// checkDailyReminders.
export function checkSchedules(now: number = Date.now()): void {
  const due = db
    .select()
    .from(choreSchedules)
    .where(and(isNotNull(choreSchedules.nextRunAt), lte(choreSchedules.nextRunAt, now)))
    .all();

  for (const row of due) {
    const target = resolveTarget(row);
    if (!target) continue;

    // The firing rule itself (flip 'complete' -> 'to-do', leave 'overdue'/'to-do'
    // alone) lives in choreService's systemReopenChore/systemReopenChoreZone — this
    // loop doesn't need to know or care whether it was a no-op.
    if (target.zoneId === null) {
      systemReopenChore(target.choreId);
    } else {
      systemReopenChoreZone(target.choreId, target.zoneId);
    }

    const nextRunAt =
      row.recurrenceType === 'once'
        ? null
        : advanceUntilFuture(toRecurrence(row), householdTimezoneForChore(target.choreId), now, row.nextRunAt!);

    db.update(choreSchedules).set({ nextRunAt }).where(eq(choreSchedules.id, row.id)).run();
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startChoreScheduler(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => checkSchedules(), CHECK_INTERVAL_MS);
}

export function stopChoreScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
