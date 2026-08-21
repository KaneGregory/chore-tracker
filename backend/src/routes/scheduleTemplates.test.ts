import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-schedule-templates-routes-'));
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

describe('schedule templates', () => {
  it('lets the head create a schedule template and lists it back', async () => {
    const head = await registerHeadOfHousehold('template-hoh@example.com', 'Template House');

    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'every_n_days',
        name: 'Daily evenings',
        startTime: '18:00',
        intervalDays: 1,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.scheduleTemplate).toEqual({
      id: expect.any(Number),
      name: 'Daily evenings',
      recurrenceType: 'every_n_days',
      startTime: '18:00',
      intervalDays: 1,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
      overdueAfter: null,
    });

    const listResponse = await request(app)
      .get(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.scheduleTemplates).toEqual([createResponse.body.scheduleTemplate]);
  });

  it('creates a weekly schedule template with the given weekdays', async () => {
    const head = await registerHeadOfHousehold('template-weekly-hoh@example.com', 'Weekly Template House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'weekly',
        name: 'Weekday mornings',
        startTime: '08:00',
        intervalWeeks: 1,
        weekdays: [1, 3, 5],
      });

    expect(response.status).toBe(201);
    expect(response.body.scheduleTemplate.weekdays).toEqual([1, 3, 5]);
  });

  it('creates a monthly schedule template with an explicit day of month', async () => {
    const head = await registerHeadOfHousehold('template-monthly-hoh@example.com', 'Monthly Template House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'monthly',
        name: 'Monthly reset',
        startTime: '09:00',
        intervalMonths: 1,
        dayOfMonth: 1,
      });

    expect(response.status).toBe(201);
    expect(response.body.scheduleTemplate.dayOfMonth).toBe(1);
  });

  it('rejects a non-head member with 403', async () => {
    const head = await registerHeadOfHousehold('template-member-hoh@example.com', 'Member Template House');
    const member = await registerAndJoin('template-member@example.com', head);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', member.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Not yours', startTime: '09:00', intervalDays: 1 });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('lets any member list schedule templates', async () => {
    const head = await registerHeadOfHousehold('template-list-hoh@example.com', 'List Template House');
    const member = await registerAndJoin('template-list-member@example.com', head);
    await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Shared template', startTime: '09:00', intervalDays: 1 });

    const response = await request(app)
      .get(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.scheduleTemplates).toHaveLength(1);
  });

  it('removes a schedule template', async () => {
    const head = await registerHeadOfHousehold('template-remove-hoh@example.com', 'Remove Template House');
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'To remove', startTime: '09:00', intervalDays: 1 });
    const scheduleTemplateId = createResponse.body.scheduleTemplate.id;

    const removeResponse = await request(app)
      .delete(`/api/households/${head.householdId}/schedule-templates/${scheduleTemplateId}`)
      .set('Cookie', head.cookie);
    expect(removeResponse.status).toBe(204);

    const listResponse = await request(app)
      .get(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie);
    expect(listResponse.body.scheduleTemplates).toEqual([]);
  });

  it('rejects a non-member with a generic 404 when listing', async () => {
    const head = await registerHeadOfHousehold('template-outsider-hoh@example.com', 'Outsider Template House');
    const outsider = await registerHeadOfHousehold('template-outsider@example.com', 'Outsider Template House 2');

    const response = await request(app)
      .get(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', outsider.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('404s removing a schedule template that belongs to a different household', async () => {
    const headA = await registerHeadOfHousehold('template-cross-del-a-hoh@example.com', 'Cross Del Template House A');
    const headB = await registerHeadOfHousehold('template-cross-del-b-hoh@example.com', 'Cross Del Template House B');
    const createResponse = await request(app)
      .post(`/api/households/${headA.householdId}/schedule-templates`)
      .set('Cookie', headA.cookie)
      .send({
        recurrenceType: 'every_n_days',
        name: 'House A template to remove',
        startTime: '09:00',
        intervalDays: 1,
      });
    const scheduleTemplateId = createResponse.body.scheduleTemplate.id;

    const response = await request(app)
      .delete(`/api/households/${headB.householdId}/schedule-templates/${scheduleTemplateId}`)
      .set('Cookie', headB.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ScheduleTemplateNotFound');
  });

  it('rejects a non-head member removing a schedule template with 403', async () => {
    const head = await registerHeadOfHousehold('template-remove-member-hoh@example.com', 'Remove Member House');
    const member = await registerAndJoin('template-remove-member@example.com', head);
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Head only to remove', startTime: '09:00', intervalDays: 1 });
    const scheduleTemplateId = createResponse.body.scheduleTemplate.id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/schedule-templates/${scheduleTemplateId}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a monthly schedule template with an out-of-range dayOfMonth with 400', async () => {
    const head = await registerHeadOfHousehold('template-invalid-day-hoh@example.com', 'Invalid Day House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
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

  it('dedupes and sorts weekly schedule template weekdays', async () => {
    const head = await registerHeadOfHousehold('template-weekday-dedup-hoh@example.com', 'Weekday Dedup House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'weekly',
        name: 'Dedup weekdays',
        startTime: '08:00',
        intervalWeeks: 1,
        weekdays: [5, 1, 5, 3],
      });

    expect(response.status).toBe(201);
    expect(response.body.scheduleTemplate.weekdays).toEqual([1, 3, 5]);
  });

  it('carries an overdue timer on a schedule template', async () => {
    const head = await registerHeadOfHousehold('template-overdue-hoh@example.com', 'Overdue Template House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'every_n_days',
        name: 'With overdue timer',
        startTime: '09:00',
        intervalDays: 1,
        overdueAfter: { amount: 3, unit: 'hours' },
      });

    expect(response.status).toBe(201);
    expect(response.body.scheduleTemplate.overdueAfter).toEqual({ amount: 3, unit: 'hours' });
  });
});
