import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
vi.mock('web-push', () => ({
  default: { setVapidDetails, sendNotification },
}));

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-push-service-'));
process.env.DB_FILE = join(testDir, 'test.db');

const { runMigrations, sqlite, db } = await import('../db/client.js');
const { users, pushSubscriptions } = await import('../db/schema.js');
const pushService = await import('./pushService.js');

runMigrations();

let userId: number;
let otherUserId: number;

beforeAll(() => {
  const now = Date.now();
  userId = db
    .insert(users)
    .values({ username: 'push-user', email: 'push-user@example.com', passwordHash: 'x', createdAt: now })
    .returning({ id: users.id })
    .get().id;
  otherUserId = db
    .insert(users)
    .values({
      username: 'push-user-2',
      email: 'push-user-2@example.com',
      passwordHash: 'x',
      createdAt: now,
    })
    .returning({ id: users.id })
    .get().id;
});

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('without VAPID keys configured', () => {
  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    sendNotification.mockClear();
  });

  it('getPublicKey returns null', () => {
    expect(pushService.getPublicKey()).toBeNull();
  });

  it('notifyUser is a no-op and never calls web-push', () => {
    pushService.notifyUser(userId, { title: 'Hi', body: 'there' });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('with VAPID keys configured', () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';
    sendNotification.mockReset();
    db.delete(pushSubscriptions).run();
  });

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it('getPublicKey returns the configured key', () => {
    expect(pushService.getPublicKey()).toBe('test-public-key');
  });

  it('stores a new subscription, and re-saving the same endpoint updates it rather than erroring', () => {
    pushService.saveSubscription(userId, {
      endpoint: 'https://push.example.com/sub-1',
      keys: { p256dh: 'p256dh-a', auth: 'auth-a' },
      timezone: 'America/New_York',
    });
    pushService.saveSubscription(otherUserId, {
      endpoint: 'https://push.example.com/sub-1',
      keys: { p256dh: 'p256dh-b', auth: 'auth-b' },
      timezone: 'America/New_York',
    });

    const rows = db.select().from(pushSubscriptions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: otherUserId, p256dh: 'p256dh-b', auth: 'auth-b' });
  });

  it('removeSubscription only deletes a subscription owned by that user', () => {
    pushService.saveSubscription(userId, {
      endpoint: 'https://push.example.com/sub-2',
      keys: { p256dh: 'p256dh', auth: 'auth' },
      timezone: 'America/New_York',
    });

    pushService.removeSubscription(otherUserId, 'https://push.example.com/sub-2');
    expect(
      db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, 'https://push.example.com/sub-2'))
        .all(),
    ).toHaveLength(1);

    pushService.removeSubscription(userId, 'https://push.example.com/sub-2');
    expect(
      db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, 'https://push.example.com/sub-2'))
        .all(),
    ).toHaveLength(0);
  });

  it('sends to every subscription belonging to that user', () => {
    pushService.saveSubscription(userId, {
      endpoint: 'https://push.example.com/a',
      keys: { p256dh: 'a', auth: 'a' },
      timezone: 'America/New_York',
    });
    pushService.saveSubscription(userId, {
      endpoint: 'https://push.example.com/b',
      keys: { p256dh: 'b', auth: 'b' },
      timezone: 'America/New_York',
    });
    sendNotification.mockResolvedValue(undefined);

    pushService.notifyUser(userId, { title: 'Chore overdue', body: 'Take out trash' });

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example.com/a' }),
      JSON.stringify({ title: 'Chore overdue', body: 'Take out trash' }),
    );
  });

  it('deletes the subscription when the push service reports it gone (410)', async () => {
    pushService.saveSubscription(userId, {
      endpoint: 'https://push.example.com/stale',
      keys: { p256dh: 'a', auth: 'a' },
      timezone: 'America/New_York',
    });
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));

    pushService.notifyUser(userId, { title: 'x', body: 'y' });
    // notifyUser fires the send without awaiting it — flush microtasks before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, 'https://push.example.com/stale'))
        .all(),
    ).toHaveLength(0);
  });

  it('keeps the subscription on a non-410/404 error', async () => {
    pushService.saveSubscription(userId, {
      endpoint: 'https://push.example.com/transient',
      keys: { p256dh: 'a', auth: 'a' },
      timezone: 'America/New_York',
    });
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error('Server error'), { statusCode: 500 }),
    );

    pushService.notifyUser(userId, { title: 'x', body: 'y' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, 'https://push.example.com/transient'))
        .all(),
    ).toHaveLength(1);
  });
});
