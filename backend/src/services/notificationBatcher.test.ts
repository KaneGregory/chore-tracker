import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';

const notifyUser = vi.fn();
vi.mock('./pushService.js', () => ({ notifyUser }));

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-notification-batcher-'));
process.env.DB_FILE = join(testDir, 'test.db');

const { runMigrations, sqlite, db } = await import('../db/client.js');
const { users, households, chores, choreZones, choreAssignments, zones } = await import(
  '../db/schema.js'
);
const batcher = await import('./notificationBatcher.js');

runMigrations();

const BATCH_DELAY_MS = 2 * 60 * 1000;

let recipientId: number;
let choreAId: number;
let choreBId: number;
let zoneId: number;

beforeAll(() => {
  const now = Date.now();
  recipientId = db
    .insert(users)
    .values({ username: 'recipient', email: 'recipient@example.com', passwordHash: 'x', createdAt: now })
    .returning({ id: users.id })
    .get().id;
  const householdId = db
    .insert(households)
    .values({ name: 'Test House', joinCode: 'TESTCODE', createdByUserId: recipientId, createdAt: now })
    .returning({ id: households.id })
    .get().id;
  zoneId = db
    .insert(zones)
    .values({ householdId, parentZoneId: null, name: 'Test House', createdAt: now })
    .returning({ id: zones.id })
    .get().id;
  choreAId = db
    .insert(chores)
    .values({ householdId, name: 'Dishes', createdAt: now })
    .returning({ id: chores.id })
    .get().id;
  choreBId = db
    .insert(chores)
    .values({ householdId, name: 'Laundry', createdAt: now })
    .returning({ id: chores.id })
    .get().id;
});

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.useFakeTimers();
  notifyUser.mockClear();
  db.delete(choreAssignments).run();
  db.delete(choreZones).run();
  db.update(chores).set({ status: 'to-do' }).run();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function setChoreStatus(choreId: number, status: 'to-do' | 'complete' | 'overdue'): void {
  db.update(chores).set({ status }).where(eq(chores.id, choreId)).run();
}

describe('queueOverdueNotification', () => {
  it('debounces: does not notify until the delay elapses', () => {
    setChoreStatus(choreAId, 'overdue');
    batcher.queueOverdueNotification(recipientId, choreAId, null, 'Dishes');

    vi.advanceTimersByTime(BATCH_DELAY_MS - 1);
    expect(notifyUser).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(notifyUser).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on a new event for the same recipient', () => {
    setChoreStatus(choreAId, 'overdue');
    setChoreStatus(choreBId, 'overdue');
    batcher.queueOverdueNotification(recipientId, choreAId, null, 'Dishes');
    vi.advanceTimersByTime(BATCH_DELAY_MS - 1);
    batcher.queueOverdueNotification(recipientId, choreBId, null, 'Laundry');
    vi.advanceTimersByTime(BATCH_DELAY_MS - 1);
    expect(notifyUser).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(notifyUser).toHaveBeenCalledTimes(1);
  });

  it('drops an item that is no longer overdue by flush time', () => {
    setChoreStatus(choreAId, 'overdue');
    batcher.queueOverdueNotification(recipientId, choreAId, null, 'Dishes');

    // The chore gets marked complete before the debounce window closes — no
    // notification should fire at all for a single-item batch that no longer holds.
    setChoreStatus(choreAId, 'complete');
    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('sends a single-item notification using the plain phrasing when the item survives', () => {
    setChoreStatus(choreAId, 'overdue');
    batcher.queueOverdueNotification(recipientId, choreAId, null, 'Dishes');

    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).toHaveBeenCalledWith(recipientId, {
      title: 'Chore overdue',
      body: 'Dishes',
      url: '/',
    });
  });

  it('combines multiple surviving items into one digest notification', () => {
    setChoreStatus(choreAId, 'overdue');
    setChoreStatus(choreBId, 'overdue');
    batcher.queueOverdueNotification(recipientId, choreAId, null, 'Dishes');
    batcher.queueOverdueNotification(recipientId, choreBId, null, 'Laundry');

    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).toHaveBeenCalledTimes(1);
    const [, payload] = notifyUser.mock.calls[0]!;
    expect(payload.title).toBe('2 chore updates');
    expect(payload.body).toContain('Dishes is overdue');
    expect(payload.body).toContain('Laundry is overdue');
  });

  it('only includes chores that are still overdue in a mixed digest', () => {
    setChoreStatus(choreAId, 'overdue');
    setChoreStatus(choreBId, 'overdue');
    batcher.queueOverdueNotification(recipientId, choreAId, null, 'Dishes');
    batcher.queueOverdueNotification(recipientId, choreBId, null, 'Laundry');

    // Laundry gets resolved before the batch flushes — only Dishes should survive.
    setChoreStatus(choreBId, 'complete');
    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).toHaveBeenCalledWith(recipientId, {
      title: 'Chore overdue',
      body: 'Dishes',
      url: '/',
    });
  });

  it('dedupes repeated events for the same chore/zone into a single description', () => {
    setChoreStatus(choreAId, 'overdue');
    batcher.queueOverdueNotification(recipientId, choreAId, null, 'Dishes');
    vi.advanceTimersByTime(BATCH_DELAY_MS - 1);
    batcher.queueOverdueNotification(recipientId, choreAId, null, 'Dishes');

    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(recipientId, {
      title: 'Chore overdue',
      body: 'Dishes',
      url: '/',
    });
  });
});

describe('queueReopenedNotification', () => {
  it('survives only while the chore/zone is still to-do', () => {
    setChoreStatus(choreAId, 'to-do');
    batcher.queueReopenedNotification(recipientId, choreAId, null, 'Dishes');

    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).toHaveBeenCalledWith(recipientId, {
      title: 'Chore reopened',
      body: 'Dishes',
      url: '/',
    });
  });

  it('is dropped if marked complete again before the batch flushes', () => {
    setChoreStatus(choreAId, 'to-do');
    batcher.queueReopenedNotification(recipientId, choreAId, null, 'Dishes');
    setChoreStatus(choreAId, 'complete');

    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).not.toHaveBeenCalled();
  });
});

describe('queueAssignmentNotification', () => {
  it('survives only while the assignment still exists', () => {
    const now = Date.now();
    db.insert(choreAssignments)
      .values({ choreId: choreAId, zoneId: null, userId: recipientId, createdAt: now })
      .run();
    batcher.queueAssignmentNotification(recipientId, choreAId, null, 'Dishes');

    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).toHaveBeenCalledWith(recipientId, {
      title: 'New chore assigned',
      body: 'Dishes',
      url: '/',
    });
  });

  it('is dropped if unassigned before the batch flushes', () => {
    const now = Date.now();
    db.insert(choreAssignments)
      .values({ choreId: choreBId, zoneId: null, userId: recipientId, createdAt: now })
      .run();
    batcher.queueAssignmentNotification(recipientId, choreBId, null, 'Laundry');

    db.delete(choreAssignments)
      .where(and(eq(choreAssignments.choreId, choreBId), eq(choreAssignments.userId, recipientId)))
      .run();

    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('respects zone-scoped assignments independently of the chore id', () => {
    const now = Date.now();
    db.insert(choreZones).values({ choreId: choreAId, zoneId }).run();
    db.insert(choreAssignments)
      .values({ choreId: choreAId, zoneId, userId: recipientId, createdAt: now })
      .run();
    batcher.queueAssignmentNotification(recipientId, choreAId, zoneId, 'Dishes');

    vi.advanceTimersByTime(BATCH_DELAY_MS);

    expect(notifyUser).toHaveBeenCalledWith(recipientId, {
      title: 'New chore assigned',
      body: 'Dishes',
      url: '/',
    });
  });
});
