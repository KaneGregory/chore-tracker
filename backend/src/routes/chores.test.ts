import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-chores-routes-'));
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
      password: 'correct-horse-battery',
      household: { mode: 'create', name: householdName },
    });
  return {
    cookie: cookieFrom(response),
    householdId: response.body.households[0].id as number,
    joinCode: response.body.households[0].joinCode as string,
  };
}

async function registerAndJoin(email: string, joinCode: string) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'correct-horse-battery', household: { mode: 'join', joinCode } });
  return { cookie: cookieFrom(response) };
}

async function getRootZoneId(householdId: number, cookie: string): Promise<number> {
  const response = await request(app)
    .get(`/api/households/${householdId}/zones`)
    .set('Cookie', cookie);
  return response.body.root.id;
}

async function createZone(householdId: number, cookie: string, name: string, parentZoneId: number) {
  const response = await request(app)
    .post(`/api/households/${householdId}/zones`)
    .set('Cookie', cookie)
    .send({ name, parentZoneId });
  function find(node: { id: number; name: string; children: unknown[] }): number | undefined {
    if (node.name === name) return node.id;
    for (const child of node.children as { id: number; name: string; children: unknown[] }[]) {
      const found = find(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const id = find(response.body.root);
  if (id === undefined) throw new Error(`Zone ${name} not found after creation`);
  return id;
}

describe('POST /api/households/:householdId/chores', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;
  let rootZoneId: number;
  let kitchenZoneId: number;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('chores-hoh@example.com', 'Chores House');
    member = await registerAndJoin('chores-member@example.com', head.joinCode);
    rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    kitchenZoneId = await createZone(head.householdId, head.cookie, 'Kitchen', rootZoneId);
  });

  it('lets the head create a single-time chore with no zones', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Take out trash', type: 'single-time', zoneIds: [] });

    expect(response.status).toBe(201);
    expect(response.body.chore).toEqual({
      id: expect.any(Number),
      name: 'Take out trash',
      type: 'single-time',
      zoneIds: [],
    });
  });

  it('lets the head create a forever chore with no zoneIds field at all', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Water the plants', type: 'forever' });

    expect(response.status).toBe(201);
    expect(response.body.chore.zoneIds).toEqual([]);
  });

  it('assigns a chore to a single zone', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Wash dishes', type: 'forever', zoneIds: [kitchenZoneId] });

    expect(response.status).toBe(201);
    expect(response.body.chore.zoneIds).toEqual([kitchenZoneId]);
  });

  it('assigns a chore to multiple zones', async () => {
    const bathroomZoneId = await createZone(head.householdId, head.cookie, 'Bathroom', rootZoneId);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Deep clean', type: 'single-time', zoneIds: [kitchenZoneId, bathroomZoneId] });

    expect(response.status).toBe(201);
    expect(response.body.chore.zoneIds.sort()).toEqual([kitchenZoneId, bathroomZoneId].sort());
  });

  it('dedupes repeated zone ids in the request', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Sweep floor', type: 'forever', zoneIds: [kitchenZoneId, kitchenZoneId] });

    expect(response.status).toBe(201);
    expect(response.body.chore.zoneIds).toEqual([kitchenZoneId]);
  });

  it('rejects a non-head member with 403', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', member.cookie)
      .send({ name: 'Mow the lawn', type: 'forever', zoneIds: [] });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a non-member with a generic 404', async () => {
    const outsider = await registerHeadOfHousehold('chores-outsider@example.com', 'Outsider House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', outsider.cookie)
      .send({ name: 'Not allowed', type: 'forever', zoneIds: [] });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects a zone id belonging to a different household with 404', async () => {
    const other = await registerHeadOfHousehold('chores-other@example.com', 'Other House');
    const otherRootId = await getRootZoneId(other.householdId, other.cookie);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Cross household', type: 'forever', zoneIds: [otherRootId] });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ZoneNotFound');
  });

  it('rejects an invalid chore type with 400', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Bad type', type: 'weekly', zoneIds: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects an empty chore name with 400', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: '   ', type: 'forever', zoneIds: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .send({ name: 'Nope', type: 'forever', zoneIds: [] });

    expect(response.status).toBe(401);
  });
});

describe('GET /api/households/:householdId/chores', () => {
  it('is visible to any member and reflects assigned zones', async () => {
    const head = await registerHeadOfHousehold('chores-list-hoh@example.com', 'List House');
    const member = await registerAndJoin('chores-list-member@example.com', head.joinCode);
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);

    await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Vacuum', type: 'forever', zoneIds: [rootZoneId] });

    const response = await request(app)
      .get(`/api/households/${head.householdId}/chores`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.chores).toEqual([
      { id: expect.any(Number), name: 'Vacuum', type: 'forever', zoneIds: [rootZoneId] },
    ]);
  });

  it('rejects a non-member with a generic 404', async () => {
    const head = await registerHeadOfHousehold('chores-list-hoh2@example.com', 'List House 2');
    const outsider = await registerHeadOfHousehold(
      'chores-list-outsider@example.com',
      'Outsider List House',
    );

    const response = await request(app)
      .get(`/api/households/${head.householdId}/chores`)
      .set('Cookie', outsider.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const head = await registerHeadOfHousehold('chores-list-hoh3@example.com', 'List House 3');
    const response = await request(app).get(`/api/households/${head.householdId}/chores`);
    expect(response.status).toBe(401);
  });
});
