import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

// Unlike chores.test.ts (which mocks notificationBatcher.js to keep its tests fast
// and synchronous), this file exercises the real batcher wired to the real
// choreService — only pushService.js's actual web-push send is mocked. It closes the
// gap between "the batcher works in isolation" (notificationBatcher.test.ts) and
// "choreService actually queues into it correctly" (chores.test.ts's mocked
// assertions) by proving the two wired together, end to end, produce a real
// notifyUser call after the real debounce delay.
const notifyUser = vi.fn();
vi.mock('../services/pushService.js', () => ({
  notifyUser,
  getPublicKey: vi.fn(() => null),
  saveSubscription: vi.fn(),
  removeSubscription: vi.fn(),
  notifyOneSubscription: vi.fn(),
}));

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-notification-integration-'));
process.env.DB_FILE = join(testDir, 'test.db');
process.env.SESSION_TTL_DAYS = '30';
process.env.CORS_ORIGIN = 'http://localhost:5173';

const { runMigrations, sqlite } = await import('../db/client.js');
const { createApp } = await import('../app.js');

runMigrations();
const app = createApp();

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

const BATCH_DELAY_MS = 2 * 60 * 1000;

function cookieFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookie) throw new Error('Expected a session cookie to be set');
  return cookie;
}

async function registerHeadOfHousehold(email: string, householdName: string) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      username: email.split('@')[0],
      password: 'correct-horse-battery',
      household: { mode: 'create', name: householdName },
    });
  return {
    cookie: cookieFrom(response),
    householdId: response.body.households[0].id as number,
    joinCode: response.body.households[0].joinCode as string,
  };
}

async function registerAndJoin(email: string, head: Awaited<ReturnType<typeof registerHeadOfHousehold>>) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      username: email.split('@')[0],
      password: 'correct-horse-battery',
      household: { mode: 'join', joinCode: head.joinCode },
    });
  const cookie = cookieFrom(response);
  const userId = response.body.user.id as number;
  await request(app)
    .post(`/api/households/${head.householdId}/members/${userId}/approve`)
    .set('Cookie', head.cookie);
  return { cookie, userId };
}

describe('choreService wired to the real notificationBatcher', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('sends a real notifyUser call after the debounce delay for an assignment', async () => {
    const head = await registerHeadOfHousehold('integration-hoh@example.com', 'Integration House');
    const member = await registerAndJoin('integration-member@example.com', head);

    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Vacuum', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;

    notifyUser.mockClear();
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${choreId}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: member.userId });

    // Still debouncing — the real timer hasn't fired yet.
    expect(notifyUser).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(BATCH_DELAY_MS);

    expect(notifyUser).toHaveBeenCalledWith(member.userId, {
      title: 'New chore assigned',
      body: 'Vacuum',
      url: '/',
    });
  });
});
