import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

vi.mock('./notificationBatcher.js', () => ({
  queueOverdueNotification: vi.fn(),
  queueReopenedNotification: vi.fn(),
  queueAssignmentNotification: vi.fn(),
}));
const { queueOverdueNotification, queueReopenedNotification } = await import('./notificationBatcher.js');

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-chore-service-'));
process.env.DB_FILE = join(testDir, 'test.db');

const { runMigrations, sqlite, db } = await import('../db/client.js');
const { users, households, householdMembers, chores, choreZones, choreAssignments, choreSchedules, zones } =
  await import('../db/schema.js');
const choreService = await import('./choreService.js');

runMigrations();

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

let userId: number;
let householdId: number;

beforeAll(() => {
  userId = db
    .insert(users)
    .values({ username: 'chore-owner', email: 'chore-owner@example.com', passwordHash: 'x', createdAt: Date.now() })
    .returning({ id: users.id })
    .get().id;
});

beforeEach(() => {
  vi.clearAllMocks();
  db.delete(choreSchedules).run();
  db.delete(choreZones).run();
  db.delete(chores).run();
  db.delete(zones).run();
  db.delete(householdMembers).run();
  db.delete(households).run();

  const now = Date.now();
  householdId = db
    .insert(households)
    .values({ name: 'Chore House', joinCode: `CHORE${now}`, createdByUserId: userId, timezone: 'UTC', createdAt: now })
    .returning({ id: households.id })
    .get().id;

  // Inserting the household row directly (bypassing authService.register) never
  // creates a household_members row, so setChoreStatus/setChoreZoneStatus/createChore
  // — which all gate on requireMembership/requireHeadMembership — would otherwise
  // reject every call in this file with HouseholdNotFound. Mirrors what
  // authService.register does for a household's creator: active, head.
  db.insert(householdMembers)
    .values({ userId, householdId, role: 'head', status: 'active', createdAt: now })
    .run();
});

function insertChore(status: 'to-do' | 'complete' | 'overdue' = 'to-do', todoSince: number | null = null) {
  const now = Date.now();
  return db
    .insert(chores)
    .values({ householdId, name: 'Test chore', status, todoSince, createdAt: now })
    .returning({ id: chores.id })
    .get().id;
}

function insertZone() {
  const now = Date.now();
  return db
    .insert(zones)
    .values({ householdId, parentZoneId: null, name: 'Root', createdAt: now })
    .returning({ id: zones.id })
    .get().id;
}

function insertChoreZone(choreId: number, zoneId: number, status: 'to-do' | 'complete' | 'overdue', todoSince: number | null = null) {
  return db.insert(choreZones).values({ choreId, zoneId, status, todoSince }).returning({ id: choreZones.id }).get().id;
}

// Distinct from `userId` (the requester in most tests below) specifically so
// notifyAssignees' "never notify the requester about their own change" exclusion
// doesn't also swallow the assertions in this file that check a notification was
// queued.
function insertAssignee(choreId: number) {
  const now = Date.now();
  const assigneeId = db
    .insert(users)
    .values({ username: `assignee-${now}-${Math.random()}`, createdAt: now })
    .returning({ id: users.id })
    .get().id;
  db.insert(choreAssignments).values({ choreId, zoneId: null, userId: assigneeId, createdAt: now }).run();
  return assigneeId;
}

function insertScheduleWithOverdueTimer(target: { choreId?: number; choreZoneId?: number }, amount: number, unit: 'minutes' | 'hours' | 'days') {
  const now = Date.now();
  return db
    .insert(choreSchedules)
    .values({
      choreId: target.choreId ?? null,
      choreZoneId: target.choreZoneId ?? null,
      recurrenceType: 'once',
      startAt: now,
      intervalDays: null,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
      overdueAfterAmount: amount,
      overdueAfterUnit: unit,
      overdueAt: null,
      nextRunAt: null,
      createdAt: now,
    })
    .returning({ id: choreSchedules.id })
    .get();
}

describe('createChore', () => {
  it('sets todoSince on the new chore and its zone links', () => {
    const zoneId = insertZone();
    const before = Date.now();
    const chore = choreService.createChore(householdId, userId, 'New chore', [zoneId]);
    const choreRow = db.select().from(chores).where(eq(chores.id, chore.id)).get()!;
    expect(choreRow.todoSince).toBeGreaterThanOrEqual(before);
    const zoneRow = db.select().from(choreZones).where(eq(choreZones.choreId, chore.id)).get()!;
    expect(zoneRow.todoSince).toBeGreaterThanOrEqual(before);
  });
});

describe('setChoreStatus', () => {
  it('sets todoSince when transitioning complete -> to-do, and notifies assignees of the reopen', () => {
    const choreId = insertChore('complete', 1000);
    const assigneeId = insertAssignee(choreId);
    const before = Date.now();

    choreService.setChoreStatus(householdId, choreId, userId, 'to-do');

    const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
    expect(row.todoSince).toBeGreaterThanOrEqual(before);
    expect(queueReopenedNotification).toHaveBeenCalledWith(assigneeId, choreId, null, 'Test chore');
    expect(queueOverdueNotification).not.toHaveBeenCalled();
  });

  it('leaves todoSince untouched on a redundant to-do -> to-do write', () => {
    const choreId = insertChore('to-do', 1000);

    choreService.setChoreStatus(householdId, choreId, userId, 'to-do');

    const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
    expect(row.todoSince).toBe(1000);
  });

  it('leaves todoSince untouched when transitioning away from to-do', () => {
    const choreId = insertChore('to-do', 1000);

    choreService.setChoreStatus(householdId, choreId, userId, 'complete');

    const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
    expect(row.todoSince).toBe(1000);
  });

  it('recomputes overdueAt on the chore\'s schedule when it becomes to-do', () => {
    const choreId = insertChore('complete', null);
    const schedule = insertScheduleWithOverdueTimer({ choreId }, 2, 'hours');
    const before = Date.now();

    choreService.setChoreStatus(householdId, choreId, userId, 'to-do');

    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get()!;
    expect(row.overdueAt).toBeGreaterThanOrEqual(before + 2 * 60 * 60 * 1000);
  });
});

describe('setChoreZoneStatus', () => {
  it('sets todoSince on the zone link when transitioning complete -> to-do', () => {
    const choreId = insertChore('to-do');
    const zoneId = insertZone();
    insertChoreZone(choreId, zoneId, 'complete', 1000);
    const before = Date.now();

    choreService.setChoreZoneStatus(householdId, choreId, zoneId, userId, 'to-do');

    const row = db.select().from(choreZones).where(eq(choreZones.choreId, choreId)).get()!;
    expect(row.todoSince).toBeGreaterThanOrEqual(before);
  });
});

describe('systemReopenChore', () => {
  it('sets todoSince and recomputes overdueAt when reopening', () => {
    const choreId = insertChore('complete', null);
    const schedule = insertScheduleWithOverdueTimer({ choreId }, 30, 'minutes');
    const before = Date.now();

    const result = choreService.systemReopenChore(choreId);

    expect(result).toBe(true);
    const choreRow = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
    expect(choreRow.todoSince).toBeGreaterThanOrEqual(before);
    const scheduleRow = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get()!;
    expect(scheduleRow.overdueAt).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
  });

  it('does nothing when the chore is not complete', () => {
    const choreId = insertChore('overdue', 1000);

    const result = choreService.systemReopenChore(choreId);

    expect(result).toBe(false);
    const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
    expect(row.todoSince).toBe(1000);
  });
});

describe('systemMarkOverdue', () => {
  it('flips a to-do chore to overdue and notifies assignees', () => {
    const choreId = insertChore('to-do', Date.now());
    const assigneeId = insertAssignee(choreId);

    const result = choreService.systemMarkOverdue(choreId);

    expect(result).toBe(true);
    const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
    expect(row.status).toBe('overdue');
    expect(queueOverdueNotification).toHaveBeenCalledWith(assigneeId, choreId, null, 'Test chore');
  });

  it('does nothing if the chore is no longer to-do', () => {
    const choreId = insertChore('complete', Date.now());

    const result = choreService.systemMarkOverdue(choreId);

    expect(result).toBe(false);
    const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
    expect(row.status).toBe('complete');
  });

  it('leaves todoSince untouched (only the status changes)', () => {
    const choreId = insertChore('to-do', 1000);

    choreService.systemMarkOverdue(choreId);

    const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
    expect(row.todoSince).toBe(1000);
  });
});

describe('systemMarkOverdueZone', () => {
  it('flips a to-do zone link to overdue', () => {
    const choreId = insertChore('to-do');
    const zoneId = insertZone();
    insertChoreZone(choreId, zoneId, 'to-do', Date.now());

    const result = choreService.systemMarkOverdueZone(choreId, zoneId);

    expect(result).toBe(true);
    const row = db.select().from(choreZones).where(eq(choreZones.choreId, choreId)).get()!;
    expect(row.status).toBe('overdue');
  });
});
