import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

const notifyOneSubscription = vi.fn();
vi.mock('./pushService.js', () => ({ notifyOneSubscription }));

const userHasIncompleteAssignedChores = vi.fn();
vi.mock('./choreService.js', () => ({ userHasIncompleteAssignedChores }));

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-daily-reminder-'));
process.env.DB_FILE = join(testDir, 'test.db');

const { runMigrations, sqlite, db } = await import('../db/client.js');
const { users, pushSubscriptions } = await import('../db/schema.js');
const { checkDailyReminders } = await import('./dailyReminderScheduler.js');

runMigrations();

let userId: number;

beforeAll(() => {
  const now = Date.now();
  userId = db
    .insert(users)
    .values({ username: 'daily-user', email: 'daily@example.com', passwordHash: 'x', createdAt: now })
    .returning({ id: users.id })
    .get().id;
});

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

beforeEach(() => {
  notifyOneSubscription.mockClear();
  userHasIncompleteAssignedChores.mockReset();
  db.delete(pushSubscriptions).run();
});

function insertSubscription(
  overrides: Partial<{ endpoint: string; timezone: string | null }> = {},
): { id: number } {
  const now = Date.now();
  return db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: overrides.endpoint ?? 'https://push.example.com/a',
      p256dh: 'p',
      auth: 'a',
      timezone: 'timezone' in overrides ? overrides.timezone : 'UTC',
      createdAt: now,
    })
    .returning({ id: pushSubscriptions.id })
    .get();
}

const NINE_AM_UTC = Date.UTC(2026, 0, 15, 9, 0, 0);
const EIGHT_AM_UTC = Date.UTC(2026, 0, 15, 8, 0, 0);
// America/New_York is EST (UTC-5, no DST) in January, so 9am there is 14:00 UTC.
const NINE_AM_NY = Date.UTC(2026, 0, 15, 14, 0, 0);

describe('checkDailyReminders', () => {
  it('sends when it is 9am local time and the user has incomplete chores', () => {
    insertSubscription({ timezone: 'UTC' });
    userHasIncompleteAssignedChores.mockReturnValue(true);

    checkDailyReminders(NINE_AM_UTC);

    expect(notifyOneSubscription).toHaveBeenCalledTimes(1);
  });

  it('does not send, but still marks the day checked, when nothing is outstanding', () => {
    const sub = insertSubscription({ timezone: 'UTC' });
    userHasIncompleteAssignedChores.mockReturnValue(false);

    checkDailyReminders(NINE_AM_UTC);

    expect(notifyOneSubscription).not.toHaveBeenCalled();
    const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).get();
    expect(row?.lastDailyReminderAt).toBe(NINE_AM_UTC);
  });

  it('does nothing outside the 9am local hour', () => {
    insertSubscription({ timezone: 'UTC' });
    userHasIncompleteAssignedChores.mockReturnValue(true);

    checkDailyReminders(EIGHT_AM_UTC);

    expect(notifyOneSubscription).not.toHaveBeenCalled();
  });

  it('only checks once per local calendar day', () => {
    insertSubscription({ timezone: 'UTC' });
    userHasIncompleteAssignedChores.mockReturnValue(true);

    checkDailyReminders(NINE_AM_UTC);
    checkDailyReminders(NINE_AM_UTC + 30_000);

    expect(notifyOneSubscription).toHaveBeenCalledTimes(1);
  });

  it('fires again the next day', () => {
    insertSubscription({ timezone: 'UTC' });
    userHasIncompleteAssignedChores.mockReturnValue(true);

    checkDailyReminders(NINE_AM_UTC);
    checkDailyReminders(NINE_AM_UTC + 24 * 60 * 60 * 1000);

    expect(notifyOneSubscription).toHaveBeenCalledTimes(2);
  });

  it('skips subscriptions with no timezone recorded yet', () => {
    insertSubscription({ timezone: null });
    userHasIncompleteAssignedChores.mockReturnValue(true);

    checkDailyReminders(NINE_AM_UTC);

    expect(notifyOneSubscription).not.toHaveBeenCalled();
  });

  it('evaluates each subscription against its own timezone', () => {
    insertSubscription({ endpoint: 'https://push.example.com/utc', timezone: 'UTC' });
    insertSubscription({ endpoint: 'https://push.example.com/ny', timezone: 'America/New_York' });
    userHasIncompleteAssignedChores.mockReturnValue(true);

    // At 14:00 UTC it's 9am in New York but 2pm in UTC — only the NY subscription
    // should fire.
    checkDailyReminders(NINE_AM_NY);

    expect(notifyOneSubscription).toHaveBeenCalledTimes(1);
  });
});
