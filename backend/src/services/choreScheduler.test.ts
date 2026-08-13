import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

const systemReopenChore = vi.fn();
const systemReopenChoreZone = vi.fn();
vi.mock('./choreService.js', () => ({ systemReopenChore, systemReopenChoreZone }));

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-chore-scheduler-'));
process.env.DB_FILE = join(testDir, 'test.db');

const { runMigrations, sqlite, db } = await import('../db/client.js');
const { users, households, chores, choreZones, choreSchedules, zones } = await import('../db/schema.js');
const { checkSchedules } = await import('./choreScheduler.js');

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
});
