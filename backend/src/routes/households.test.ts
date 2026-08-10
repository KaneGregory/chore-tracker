import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-households-routes-'));
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
    userId: response.body.user.id as number,
    householdId: response.body.households[0].id as number,
    joinCode: response.body.households[0].joinCode as string,
  };
}

async function registerAndJoin(email: string, joinCode: string) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      username: email.split('@')[0],
      password: 'correct-horse-battery',
      household: { mode: 'join', joinCode },
    });
  return { cookie: cookieFrom(response), userId: response.body.user.id as number };
}

describe('GET /api/households/:householdId/members', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('hoh@example.com', 'The Households');
    member = await registerAndJoin('member@example.com', head.joinCode);
  });

  it('lists members in join order with their roles', async () => {
    const response = await request(app)
      .get(`/api/households/${head.householdId}/members`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    expect(response.body.members).toEqual([
      { id: head.userId, username: 'hoh', role: 'head', isCreator: true },
      { id: member.userId, username: 'member', role: 'member', isCreator: false },
    ]);
  });

  it('is visible to any member of the household, not just the head', async () => {
    const response = await request(app)
      .get(`/api/households/${head.householdId}/members`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.members).toHaveLength(2);
  });

  it('rejects a request from someone who is not a member, with a generic 404', async () => {
    const outsider = await registerHeadOfHousehold('outsider@example.com', 'Someone Else House');

    const response = await request(app)
      .get(`/api/households/${head.householdId}/members`)
      .set('Cookie', outsider.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).get(`/api/households/${head.householdId}/members`);
    expect(response.status).toBe(401);
  });

  it('rejects a non-numeric household id with 400', async () => {
    const response = await request(app)
      .get('/api/households/not-a-number/members')
      .set('Cookie', head.cookie);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});

describe('POST /api/households/:householdId/members/:userId/promote', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let memberA: Awaited<ReturnType<typeof registerAndJoin>>;
  let memberB: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('promo-head@example.com', 'Promotion House');
    memberA = await registerAndJoin('promo-a@example.com', head.joinCode);
    memberB = await registerAndJoin('promo-b@example.com', head.joinCode);
  });

  it('lets the head of household promote a member', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${memberA.userId}/promote`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    const promoted = response.body.members.find((m: { id: number }) => m.id === memberA.userId);
    expect(promoted.role).toBe('head');
  });

  it('rejects promotion attempts from a member who is not head of household', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${memberB.userId}/promote`)
      .set('Cookie', memberB.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects promoting someone who is not a member of the household', async () => {
    const outsider = await registerHeadOfHousehold('promo-outsider@example.com', 'Other House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${outsider.userId}/promote`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('MemberNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).post(
      `/api/households/${head.householdId}/members/${memberB.userId}/promote`,
    );
    expect(response.status).toBe(401);
  });
});

describe('POST /api/households/:householdId/members/:userId/demote', () => {
  let creator: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let secondHead: Awaited<ReturnType<typeof registerAndJoin>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    creator = await registerHeadOfHousehold('demo-creator@example.com', 'Demotion House');
    secondHead = await registerAndJoin('demo-second-head@example.com', creator.joinCode);
    member = await registerAndJoin('demo-member@example.com', creator.joinCode);

    await request(app)
      .post(`/api/households/${creator.householdId}/members/${secondHead.userId}/promote`)
      .set('Cookie', creator.cookie);
  });

  it('lets the head of household demote another head back to member', async () => {
    const response = await request(app)
      .post(`/api/households/${creator.householdId}/members/${secondHead.userId}/demote`)
      .set('Cookie', creator.cookie);

    expect(response.status).toBe(200);
    const demoted = response.body.members.find((m: { id: number }) => m.id === secondHead.userId);
    expect(demoted.role).toBe('member');
  });

  it('rejects demotion attempts from a member who is not head of household', async () => {
    const response = await request(app)
      .post(`/api/households/${creator.householdId}/members/${creator.userId}/demote`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a head demoting themselves with 400', async () => {
    const response = await request(app)
      .post(`/api/households/${creator.householdId}/members/${creator.userId}/demote`)
      .set('Cookie', creator.cookie);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('CannotDemoteSelf');
  });

  it('rejects demoting the household creator, even by another head', async () => {
    await request(app)
      .post(`/api/households/${creator.householdId}/members/${secondHead.userId}/promote`)
      .set('Cookie', creator.cookie);

    const response = await request(app)
      .post(`/api/households/${creator.householdId}/members/${creator.userId}/demote`)
      .set('Cookie', secondHead.cookie);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('CannotDemoteHouseholdCreator');
  });

  it('rejects demoting someone who is not a member of the household', async () => {
    const outsider = await registerHeadOfHousehold('demo-outsider@example.com', 'Other House');

    const response = await request(app)
      .post(`/api/households/${creator.householdId}/members/${outsider.userId}/demote`)
      .set('Cookie', creator.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('MemberNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).post(
      `/api/households/${creator.householdId}/members/${member.userId}/demote`,
    );
    expect(response.status).toBe(401);
  });
});
