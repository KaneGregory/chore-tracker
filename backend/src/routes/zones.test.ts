import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-zones-routes-'));
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
    userId: response.body.user.id as number,
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

interface ZoneNode {
  id: number;
  name: string;
  isRoot: boolean;
  children: ZoneNode[];
}

function findZone(root: ZoneNode, name: string): ZoneNode | undefined {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = findZone(child, name);
    if (found) return found;
  }
  return undefined;
}

describe('GET /api/households/:householdId/zones', () => {
  it('gives every new household a single unremovable root zone named after it', async () => {
    const head = await registerHeadOfHousehold('zones-hoh@example.com', 'The Zone House');

    const response = await request(app)
      .get(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    expect(response.body.root).toEqual({
      id: expect.any(Number),
      name: 'The Zone House',
      isRoot: true,
      children: [],
    });
  });

  it('is visible to any member, not just the head', async () => {
    const head = await registerHeadOfHousehold('zones-hoh2@example.com', 'Second House');
    const member = await registerAndJoin('zones-member2@example.com', head.joinCode);

    const response = await request(app)
      .get(`/api/households/${head.householdId}/zones`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.root.name).toBe('Second House');
  });

  it('rejects a non-member with a generic 404', async () => {
    const head = await registerHeadOfHousehold('zones-hoh3@example.com', 'Third House');
    const outsider = await registerHeadOfHousehold('zones-outsider@example.com', 'Outsider House');

    const response = await request(app)
      .get(`/api/households/${head.householdId}/zones`)
      .set('Cookie', outsider.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const head = await registerHeadOfHousehold('zones-hoh4@example.com', 'Fourth House');
    const response = await request(app).get(`/api/households/${head.householdId}/zones`);
    expect(response.status).toBe(401);
  });
});

describe('POST /api/households/:householdId/zones', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;
  let rootZoneId: number;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('create-hoh@example.com', 'Create House');
    member = await registerAndJoin('create-member@example.com', head.joinCode);

    const response = await request(app)
      .get(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie);
    rootZoneId = response.body.root.id;
  });

  it('lets the head create a zone under the root', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Kitchen', parentZoneId: rootZoneId });

    expect(response.status).toBe(201);
    const kitchen = findZone(response.body.root, 'Kitchen');
    expect(kitchen).toMatchObject({ name: 'Kitchen', isRoot: false, children: [] });
  });

  it('lets the head nest a zone inside another non-root zone', async () => {
    const withKitchen = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Pantry parent', parentZoneId: rootZoneId });
    const parent = findZone(withKitchen.body.root, 'Pantry parent')!;

    const response = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Pantry', parentZoneId: parent.id });

    expect(response.status).toBe(201);
    const pantryParent = findZone(response.body.root, 'Pantry parent')!;
    expect(pantryParent.children).toEqual([
      { id: expect.any(Number), name: 'Pantry', isRoot: false, children: [] },
    ]);
  });

  it('rejects a non-head member with 403', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', member.cookie)
      .send({ name: 'Garage', parentZoneId: rootZoneId });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a parent zone id from another household with 404', async () => {
    const other = await registerHeadOfHousehold('create-other@example.com', 'Other House');
    const otherZones = await request(app)
      .get(`/api/households/${other.householdId}/zones`)
      .set('Cookie', other.cookie);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Cross-household', parentZoneId: otherZones.body.root.id });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ZoneNotFound');
  });

  it('rejects an empty zone name with 400', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: '  ', parentZoneId: rootZoneId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});

describe('DELETE /api/households/:householdId/zones/:zoneId', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;
  let rootZoneId: number;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('remove-hoh@example.com', 'Remove House');
    member = await registerAndJoin('remove-member@example.com', head.joinCode);

    const response = await request(app)
      .get(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie);
    rootZoneId = response.body.root.id;
  });

  it('rejects removing the root zone with 400', async () => {
    const response = await request(app)
      .delete(`/api/households/${head.householdId}/zones/${rootZoneId}`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('RootZoneImmutable');
  });

  it('cascades: removing a zone removes its descendants too', async () => {
    const withUpstairs = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Upstairs', parentZoneId: rootZoneId });
    const upstairs = findZone(withUpstairs.body.root, 'Upstairs')!;

    const withBedroom = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Bedroom', parentZoneId: upstairs.id });
    expect(findZone(withBedroom.body.root, 'Bedroom')).toBeDefined();

    const removeResponse = await request(app)
      .delete(`/api/households/${head.householdId}/zones/${upstairs.id}`)
      .set('Cookie', head.cookie);

    expect(removeResponse.status).toBe(200);
    expect(findZone(removeResponse.body.root, 'Upstairs')).toBeUndefined();
    expect(findZone(removeResponse.body.root, 'Bedroom')).toBeUndefined();
  });

  it('rejects a non-head member with 403', async () => {
    const withGarage = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Garage', parentZoneId: rootZoneId });
    const garage = findZone(withGarage.body.root, 'Garage')!;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/zones/${garage.id}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a zone id that does not exist with 404', async () => {
    const response = await request(app)
      .delete(`/api/households/${head.householdId}/zones/999999`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ZoneNotFound');
  });
});

describe('PATCH /api/households/:householdId/zones/:zoneId (move)', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let rootZoneId: number;
  let upstairsId: number;
  let bedroomId: number;
  let downstairsId: number;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('move-hoh@example.com', 'Move House');

    const rootResponse = await request(app)
      .get(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie);
    rootZoneId = rootResponse.body.root.id;

    const withUpstairs = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Upstairs', parentZoneId: rootZoneId });
    upstairsId = findZone(withUpstairs.body.root, 'Upstairs')!.id;

    const withBedroom = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Bedroom', parentZoneId: upstairsId });
    bedroomId = findZone(withBedroom.body.root, 'Bedroom')!.id;

    const withDownstairs = await request(app)
      .post(`/api/households/${head.householdId}/zones`)
      .set('Cookie', head.cookie)
      .send({ name: 'Downstairs', parentZoneId: rootZoneId });
    downstairsId = findZone(withDownstairs.body.root, 'Downstairs')!.id;
  });

  it('moves a zone to a different valid parent', async () => {
    const response = await request(app)
      .patch(`/api/households/${head.householdId}/zones/${bedroomId}`)
      .set('Cookie', head.cookie)
      .send({ parentZoneId: downstairsId });

    expect(response.status).toBe(200);
    const downstairs = findZone(response.body.root, 'Downstairs')!;
    expect(downstairs.children.map((c: ZoneNode) => c.name)).toContain('Bedroom');
    const upstairs = findZone(response.body.root, 'Upstairs')!;
    expect(upstairs.children).toEqual([]);
  });

  it('rejects moving a zone into itself with 400', async () => {
    const response = await request(app)
      .patch(`/api/households/${head.householdId}/zones/${upstairsId}`)
      .set('Cookie', head.cookie)
      .send({ parentZoneId: upstairsId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('InvalidZoneMove');
  });

  it('rejects moving a zone into one of its own descendants with 400', async () => {
    // Bedroom now lives under Downstairs (moved above) — moving Downstairs under
    // Bedroom would make Downstairs its own grandchild.
    const response = await request(app)
      .patch(`/api/households/${head.householdId}/zones/${downstairsId}`)
      .set('Cookie', head.cookie)
      .send({ parentZoneId: bedroomId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('InvalidZoneMove');
  });

  it('rejects moving the root zone with 400', async () => {
    const response = await request(app)
      .patch(`/api/households/${head.householdId}/zones/${rootZoneId}`)
      .set('Cookie', head.cookie)
      .send({ parentZoneId: upstairsId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('RootZoneImmutable');
  });

  it('rejects a non-numeric zone id with 400', async () => {
    const response = await request(app)
      .patch(`/api/households/${head.householdId}/zones/not-a-number`)
      .set('Cookie', head.cookie)
      .send({ parentZoneId: rootZoneId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});
