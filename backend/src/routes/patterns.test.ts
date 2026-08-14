import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-patterns-routes-'));
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

async function registerAndJoin(
  email: string,
  head: Awaited<ReturnType<typeof registerHeadOfHousehold>>,
) {
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

describe('schedule patterns', () => {
  it('lets the head create a pattern and lists it back', async () => {
    const head = await registerHeadOfHousehold('pattern-hoh@example.com', 'Pattern House');

    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'every_n_days',
        name: 'Daily evenings',
        startTime: '18:00',
        intervalDays: 1,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.pattern).toEqual({
      id: expect.any(Number),
      name: 'Daily evenings',
      recurrenceType: 'every_n_days',
      startTime: '18:00',
      intervalDays: 1,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
    });

    const listResponse = await request(app)
      .get(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.patterns).toEqual([createResponse.body.pattern]);
  });

  it('creates a weekly pattern with the given weekdays', async () => {
    const head = await registerHeadOfHousehold('pattern-weekly-hoh@example.com', 'Weekly Pattern House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'weekly',
        name: 'Weekday mornings',
        startTime: '08:00',
        intervalWeeks: 1,
        weekdays: [1, 3, 5],
      });

    expect(response.status).toBe(201);
    expect(response.body.pattern.weekdays).toEqual([1, 3, 5]);
  });

  it('creates a monthly pattern with an explicit day of month', async () => {
    const head = await registerHeadOfHousehold('pattern-monthly-hoh@example.com', 'Monthly Pattern House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'monthly',
        name: 'Monthly reset',
        startTime: '09:00',
        intervalMonths: 1,
        dayOfMonth: 1,
      });

    expect(response.status).toBe(201);
    expect(response.body.pattern.dayOfMonth).toBe(1);
  });

  it('rejects a non-head member with 403', async () => {
    const head = await registerHeadOfHousehold('pattern-member-hoh@example.com', 'Member Pattern House');
    const member = await registerAndJoin('pattern-member@example.com', head);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', member.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Not yours', startTime: '09:00', intervalDays: 1 });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('lets any member list patterns', async () => {
    const head = await registerHeadOfHousehold('pattern-list-hoh@example.com', 'List Pattern House');
    const member = await registerAndJoin('pattern-list-member@example.com', head);
    await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Shared pattern', startTime: '09:00', intervalDays: 1 });

    const response = await request(app)
      .get(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.patterns).toHaveLength(1);
  });

  it('renames a pattern', async () => {
    const head = await registerHeadOfHousehold('pattern-rename-hoh@example.com', 'Rename Pattern House');
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Old name', startTime: '09:00', intervalDays: 1 });
    const patternId = createResponse.body.pattern.id;

    const renameResponse = await request(app)
      .patch(`/api/households/${head.householdId}/patterns/${patternId}`)
      .set('Cookie', head.cookie)
      .send({ name: 'New name' });

    expect(renameResponse.status).toBe(200);
    expect(renameResponse.body.pattern.name).toBe('New name');
  });

  it('404s renaming a pattern that does not exist', async () => {
    const head = await registerHeadOfHousehold('pattern-rename-404-hoh@example.com', 'Rename 404 House');

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/patterns/999999`)
      .set('Cookie', head.cookie)
      .send({ name: 'New name' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('PatternNotFound');
  });

  it('removes a pattern', async () => {
    const head = await registerHeadOfHousehold('pattern-remove-hoh@example.com', 'Remove Pattern House');
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'To remove', startTime: '09:00', intervalDays: 1 });
    const patternId = createResponse.body.pattern.id;

    const removeResponse = await request(app)
      .delete(`/api/households/${head.householdId}/patterns/${patternId}`)
      .set('Cookie', head.cookie);
    expect(removeResponse.status).toBe(204);

    const listResponse = await request(app)
      .get(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie);
    expect(listResponse.body.patterns).toEqual([]);
  });

  it('rejects a non-member with a generic 404 when listing', async () => {
    const head = await registerHeadOfHousehold('pattern-outsider-hoh@example.com', 'Outsider Pattern House');
    const outsider = await registerHeadOfHousehold('pattern-outsider@example.com', 'Outsider Pattern House 2');

    const response = await request(app)
      .get(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', outsider.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('404s renaming a pattern that belongs to a different household', async () => {
    const headA = await registerHeadOfHousehold('pattern-cross-a-hoh@example.com', 'Cross Pattern House A');
    const headB = await registerHeadOfHousehold('pattern-cross-b-hoh@example.com', 'Cross Pattern House B');
    const createResponse = await request(app)
      .post(`/api/households/${headA.householdId}/patterns`)
      .set('Cookie', headA.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'House A pattern', startTime: '09:00', intervalDays: 1 });
    const patternId = createResponse.body.pattern.id;

    const response = await request(app)
      .patch(`/api/households/${headB.householdId}/patterns/${patternId}`)
      .set('Cookie', headB.cookie)
      .send({ name: 'Stolen name' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('PatternNotFound');
  });

  it('404s removing a pattern that belongs to a different household', async () => {
    const headA = await registerHeadOfHousehold('pattern-cross-del-a-hoh@example.com', 'Cross Del Pattern House A');
    const headB = await registerHeadOfHousehold('pattern-cross-del-b-hoh@example.com', 'Cross Del Pattern House B');
    const createResponse = await request(app)
      .post(`/api/households/${headA.householdId}/patterns`)
      .set('Cookie', headA.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'House A pattern to remove', startTime: '09:00', intervalDays: 1 });
    const patternId = createResponse.body.pattern.id;

    const response = await request(app)
      .delete(`/api/households/${headB.householdId}/patterns/${patternId}`)
      .set('Cookie', headB.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('PatternNotFound');
  });

  it('rejects a non-head member renaming a pattern with 403', async () => {
    const head = await registerHeadOfHousehold('pattern-rename-member-hoh@example.com', 'Rename Member House');
    const member = await registerAndJoin('pattern-rename-member@example.com', head);
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Head only', startTime: '09:00', intervalDays: 1 });
    const patternId = createResponse.body.pattern.id;

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/patterns/${patternId}`)
      .set('Cookie', member.cookie)
      .send({ name: 'Renamed by member' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a non-head member removing a pattern with 403', async () => {
    const head = await registerHeadOfHousehold('pattern-remove-member-hoh@example.com', 'Remove Member House');
    const member = await registerAndJoin('pattern-remove-member@example.com', head);
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Head only to remove', startTime: '09:00', intervalDays: 1 });
    const patternId = createResponse.body.pattern.id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/patterns/${patternId}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a monthly pattern with an out-of-range dayOfMonth with 400', async () => {
    const head = await registerHeadOfHousehold('pattern-invalid-day-hoh@example.com', 'Invalid Day House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'monthly',
        name: 'Invalid day of month',
        startTime: '09:00',
        intervalMonths: 1,
        dayOfMonth: 32,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('dedupes and sorts weekly pattern weekdays', async () => {
    const head = await registerHeadOfHousehold('pattern-weekday-dedup-hoh@example.com', 'Weekday Dedup House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'weekly',
        name: 'Dedup weekdays',
        startTime: '08:00',
        intervalWeeks: 1,
        weekdays: [5, 1, 5, 3],
      });

    expect(response.status).toBe(201);
    expect(response.body.pattern.weekdays).toEqual([1, 3, 5]);
  });
});
