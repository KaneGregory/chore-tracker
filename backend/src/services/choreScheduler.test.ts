import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

const systemReopenChore = vi.fn();
const systemReopenChoreZone = vi.fn();
const systemMarkOverdue = vi.fn();
const systemMarkOverdueZone = vi.fn();
vi.mock('./choreService.js', () => ({
  systemReopenChore,
  systemReopenChoreZone,
  systemMarkOverdue,
  systemMarkOverdueZone,
}));

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-chore-scheduler-'));
process.env.DB_FILE = join(testDir, 'test.db');

const { runMigrations, sqlite, db } = await import('../db/client.js');
const { users, households, chores, choreZones, choreSchedules, zones } = await import('../db/schema.js');
const { checkSchedules, checkOverdueSchedules } = await import('./choreScheduler.js');

runMigrations();

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

let userId: number;
let householdId: number;
let choreId: number;
let zoneId: number;
let choreZoneRowId: number;

// Not part of the brief's original snippet: chore_schedules' fixture needs a real
// household, and households.createdByUserId is a NOT NULL FK to users.id — the
// brief's hardcoded `createdByUserId: 1` assumed a user row that was never inserted,
// which fails with a FOREIGN KEY constraint error against a fresh db. Fixed the same
// way notificationBatcher.test.ts does: insert one real user and reference its id.
beforeAll(() => {
  userId = db
    .insert(users)
    .values({ username: 'scheduler-owner', email: 'scheduler-owner@example.com', passwordHash: 'x', createdAt: Date.now() })
    .returning({ id: users.id })
    .get().id;
});

beforeEach(() => {
  systemReopenChore.mockReset();
  systemReopenChoreZone.mockReset();
  systemMarkOverdue.mockReset();
  systemMarkOverdueZone.mockReset();
  db.delete(choreSchedules).run();
  db.delete(choreZones).run();
  db.delete(chores).run();
  db.delete(zones).run();
  db.delete(households).run();

  const now = Date.now();
  householdId = db
    .insert(households)
    .values({ name: 'Scheduler House', joinCode: `SCHED${now}`, createdByUserId: userId, timezone: 'UTC', createdAt: now })
    .returning({ id: households.id })
    .get().id;
  choreId = db
    .insert(chores)
    .values({ householdId, name: 'Scheduled chore', status: 'complete', createdAt: now })
    .returning({ id: chores.id })
    .get().id;
  zoneId = db
    .insert(zones)
    .values({ householdId, parentZoneId: null, name: 'Root', createdAt: now })
    .returning({ id: zones.id })
    .get().id;
  choreZoneRowId = db
    .insert(choreZones)
    .values({ choreId, zoneId, status: 'complete' })
    .returning({ id: choreZones.id })
    .get().id;
});

function insertSchedule(overrides: {
  choreId?: number | null;
  choreZoneId?: number | null;
  nextRunAt: number;
}) {
  const now = Date.now();
  return db
    .insert(choreSchedules)
    .values({
      choreId: overrides.choreId ?? null,
      choreZoneId: overrides.choreZoneId ?? null,
      recurrenceType: 'every_n_days',
      startAt: overrides.nextRunAt,
      intervalDays: 1,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
      nextRunAt: overrides.nextRunAt,
      createdAt: now,
    })
    .returning({ id: choreSchedules.id })
    .get();
}

function insertScheduleWithOverdueAt(overrides: {
  choreId?: number | null;
  choreZoneId?: number | null;
  overdueAt: number;
}) {
  const now = Date.now();
  return db
    .insert(choreSchedules)
    .values({
      choreId: overrides.choreId ?? null,
      choreZoneId: overrides.choreZoneId ?? null,
      recurrenceType: 'once',
      startAt: now,
      intervalDays: null,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
      overdueAfterAmount: 1,
      overdueAfterUnit: 'hours',
      overdueAt: overrides.overdueAt,
      nextRunAt: null,
      createdAt: now,
    })
    .returning({ id: choreSchedules.id })
    .get();
}

describe('checkSchedules', () => {
  it('reopens a zoneless chore whose schedule is due', () => {
    const schedule = insertSchedule({ choreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemReopenChore.mockReturnValue(true);

    checkSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemReopenChore).toHaveBeenCalledWith(choreId);
    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.nextRunAt).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });

  it('reopens a specific chore zone whose schedule is due', () => {
    const schedule = insertSchedule({ choreZoneId: choreZoneRowId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemReopenChoreZone.mockReturnValue(true);

    checkSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemReopenChoreZone).toHaveBeenCalledWith(choreId, zoneId);
    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.nextRunAt).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });

  it('does nothing before nextRunAt', () => {
    insertSchedule({ choreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });

    checkSchedules(Date.UTC(2026, 0, 1, 8, 0));

    expect(systemReopenChore).not.toHaveBeenCalled();
  });

  it('clears nextRunAt for a fired one-off schedule', () => {
    const now = Date.now();
    const schedule = db
      .insert(choreSchedules)
      .values({
        choreId,
        choreZoneId: null,
        recurrenceType: 'once',
        startAt: Date.UTC(2026, 0, 1, 9, 0),
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
        nextRunAt: Date.UTC(2026, 0, 1, 9, 0),
        createdAt: now,
      })
      .returning({ id: choreSchedules.id })
      .get();
    systemReopenChore.mockReturnValue(true);

    checkSchedules(Date.UTC(2026, 0, 1, 9, 0));

    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.nextRunAt).toBeNull();
  });

  it('still advances nextRunAt when the firing rule was a no-op (e.g. already overdue)', () => {
    insertSchedule({ choreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemReopenChore.mockReturnValue(false); // e.g. the chore was 'overdue', not 'complete'

    checkSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemReopenChore).toHaveBeenCalledWith(choreId);
    const schedules = db.select().from(choreSchedules).all();
    expect(schedules[0]?.nextRunAt).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });

  it('disables a malformed row after an error instead of crashing the whole pass', () => {
    const now = Date.now();
    // Corrupted row: recurrenceType 'every_n_days' with intervalDays null, same
    // technique as scheduleTime.test.ts's catch-up-cap test — bypasses normal
    // validation directly via db.insert, simulating a row that's malformed for any
    // reason. Alongside it, one normal, valid, also-due schedule (a second chore),
    // to prove one bad row doesn't take down the rest of the poll pass.
    const malformed = db
      .insert(choreSchedules)
      .values({
        choreId,
        choreZoneId: null,
        recurrenceType: 'every_n_days',
        startAt: Date.UTC(2026, 0, 1, 9, 0),
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
        nextRunAt: Date.UTC(2026, 0, 1, 9, 0),
        createdAt: now,
      })
      .returning({ id: choreSchedules.id })
      .get();

    const otherChoreId = db
      .insert(chores)
      .values({ householdId, name: 'Second scheduled chore', status: 'complete', createdAt: now })
      .returning({ id: chores.id })
      .get().id;
    const valid = insertSchedule({ choreId: otherChoreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemReopenChore.mockReturnValue(true);

    expect(() => checkSchedules(Date.UTC(2026, 0, 1, 9, 0))).not.toThrow();

    const malformedRow = db.select().from(choreSchedules).where(eq(choreSchedules.id, malformed.id)).get();
    expect(malformedRow?.nextRunAt).toBeNull();

    expect(systemReopenChore).toHaveBeenCalledWith(otherChoreId);
    const validRow = db.select().from(choreSchedules).where(eq(choreSchedules.id, valid.id)).get();
    expect(validRow?.nextRunAt).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });
});

describe('checkOverdueSchedules', () => {
  it('marks a zoneless chore overdue when its timer is due', () => {
    const schedule = insertScheduleWithOverdueAt({ choreId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemMarkOverdue.mockReturnValue(true);

    checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemMarkOverdue).toHaveBeenCalledWith(choreId);
    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.overdueAt).toBeNull();
  });

  it('marks a specific chore zone overdue when its timer is due', () => {
    const schedule = insertScheduleWithOverdueAt({ choreZoneId: choreZoneRowId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemMarkOverdueZone.mockReturnValue(true);

    checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemMarkOverdueZone).toHaveBeenCalledWith(choreId, zoneId);
    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.overdueAt).toBeNull();
  });

  it('does nothing before overdueAt', () => {
    insertScheduleWithOverdueAt({ choreId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });

    checkOverdueSchedules(Date.UTC(2026, 0, 1, 8, 0));

    expect(systemMarkOverdue).not.toHaveBeenCalled();
  });

  it('clears overdueAt even when the firing rule was a no-op (already completed in time)', () => {
    const schedule = insertScheduleWithOverdueAt({ choreId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemMarkOverdue.mockReturnValue(false);

    checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemMarkOverdue).toHaveBeenCalledWith(choreId);
    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.overdueAt).toBeNull();
  });

  it('does not touch a schedule whose overdueAt is null', () => {
    insertSchedule({ choreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });

    checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemMarkOverdue).not.toHaveBeenCalled();
    expect(systemMarkOverdueZone).not.toHaveBeenCalled();
  });

  it('disables a malformed row after an error instead of crashing the whole pass', () => {
    systemMarkOverdue.mockImplementation(() => {
      throw new Error('boom');
    });
    const broken = insertScheduleWithOverdueAt({ choreId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });

    expect(() => checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0))).not.toThrow();

    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, broken.id)).get();
    expect(row?.overdueAt).toBeNull();
  });
});
