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

async function registerAndJoin(email: string, joinCode: string) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      username: email.split('@')[0],
      password: 'correct-horse-battery',
      household: { mode: 'join', joinCode },
    });
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
      status: 'to-do',
      zones: [],
      assignments: [],
    });
  });

  it('lets the head create a forever chore with no zoneIds field at all', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Water the plants', type: 'forever' });

    expect(response.status).toBe(201);
    expect(response.body.chore.zones).toEqual([]);
  });

  it('assigns a chore to a single zone', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Wash dishes', type: 'forever', zoneIds: [kitchenZoneId] });

    expect(response.status).toBe(201);
    expect(response.body.chore.zones).toEqual([{ zoneId: kitchenZoneId, status: 'to-do' }]);
  });

  it('assigns a chore to multiple zones', async () => {
    const bathroomZoneId = await createZone(head.householdId, head.cookie, 'Bathroom', rootZoneId);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Deep clean', type: 'single-time', zoneIds: [kitchenZoneId, bathroomZoneId] });

    expect(response.status).toBe(201);
    const zoneIds = (response.body.chore.zones as { zoneId: number }[])
      .map((zone) => zone.zoneId)
      .sort();
    expect(zoneIds).toEqual([kitchenZoneId, bathroomZoneId].sort());
  });

  it('dedupes repeated zone ids in the request', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Sweep floor', type: 'forever', zoneIds: [kitchenZoneId, kitchenZoneId] });

    expect(response.status).toBe(201);
    expect(response.body.chore.zones).toEqual([{ zoneId: kitchenZoneId, status: 'to-do' }]);
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
      {
        id: expect.any(Number),
        name: 'Vacuum',
        type: 'forever',
        status: 'to-do',
        zones: [{ zoneId: rootZoneId, status: 'to-do' }],
        assignments: [],
      },
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

describe('POST /api/households/:householdId/chores/:choreId/assignments', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;
  let otherMember: Awaited<ReturnType<typeof registerAndJoin>>;
  let memberId: number;
  let otherMemberId: number;
  let kitchenZoneId: number;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('assign-hoh@example.com', 'Assign House');
    member = await registerAndJoin('assign-member@example.com', head.joinCode);
    otherMember = await registerAndJoin('assign-member-2@example.com', head.joinCode);
    memberId = await meId(member.cookie);
    otherMemberId = await meId(otherMember.cookie);
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    kitchenZoneId = await createZone(head.householdId, head.cookie, 'Kitchen', rootZoneId);
  });

  async function meId(cookie: string): Promise<number> {
    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);
    return response.body.user.id;
  }

  async function postChore(body: Record<string, unknown>) {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send(body);
    return response.body.chore;
  }

  it('lets a member assign a single-time chore to themself', async () => {
    const chore = await postChore({ name: 'Vacuum', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId });

    expect(response.status).toBe(201);
    expect(response.body.chore.assignments).toEqual([
      {
        id: expect.any(Number),
        userId: memberId,
        username: 'assign-member',
        zoneId: null,
      },
    ]);
  });

  it('lets a member assign a single-time chore scoped to one of its zones', async () => {
    const chore = await postChore({ name: 'Wash dishes', type: 'single-time', zoneIds: [kitchenZoneId] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId, zoneId: kitchenZoneId });

    expect(response.status).toBe(201);
    expect(response.body.chore.assignments).toEqual([
      {
        id: expect.any(Number),
        userId: memberId,
        username: 'assign-member',
        zoneId: kitchenZoneId,
      },
    ]);
  });

  it('rejects a member assigning a chore to someone else with 403', async () => {
    const chore = await postChore({ name: 'Take out trash', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: otherMemberId });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('CannotAssignOthers');
  });

  it('lets the head assign a single-time chore to any member', async () => {
    const chore = await postChore({ name: 'Mop floor', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    expect(response.status).toBe(201);
    expect(response.body.chore.assignments[0]).toEqual(
      expect.objectContaining({ userId: memberId, zoneId: null }),
    );
  });

  it('rejects assigning a forever chore with 400', async () => {
    const chore = await postChore({ name: 'Water plants', type: 'forever', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ChoreNotAssignable');
  });

  it('rejects a zone that is not one of the chore’s zones with 400', async () => {
    const chore = await postChore({ name: 'Sweep', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId, zoneId: kitchenZoneId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ChoreZoneMismatch');
  });

  it('lets multiple different members be assigned to the same chore/zone target', async () => {
    const chore = await postChore({ name: 'Fold laundry', type: 'single-time', zoneIds: [] });

    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: otherMemberId });

    expect(response.status).toBe(201);
    expect(response.body.chore.assignments.map((a: { userId: number }) => a.userId).sort()).toEqual(
      [memberId, otherMemberId].sort(),
    );
  });

  it('rejects assigning the same person to the same chore/zone target twice with 409', async () => {
    const chore = await postChore({ name: 'Scrub tub', type: 'single-time', zoneIds: [] });

    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('ChoreAlreadyAssigned');
  });

  it('rejects assigning to a userId that is not a member of the household with 404', async () => {
    const chore = await postChore({ name: 'Clean windows', type: 'single-time', zoneIds: [] });
    const outsider = await registerHeadOfHousehold('assign-outsider@example.com', 'Outsider House');
    const outsiderId = await meId(outsider.cookie);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: outsiderId });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('MemberNotFound');
  });

  it('rejects a non-existent chore id with 404', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/999999/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ChoreNotFound');
  });

  it('rejects a non-member of the household with a generic 404', async () => {
    const chore = await postChore({ name: 'Dust shelves', type: 'single-time', zoneIds: [] });
    const outsider = await registerHeadOfHousehold('assign-outsider-2@example.com', 'Outsider House 2');
    const outsiderId = await meId(outsider.cookie);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', outsider.cookie)
      .send({ userId: outsiderId });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const chore = await postChore({ name: 'Take out recycling', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .send({ userId: memberId });

    expect(response.status).toBe(401);
  });

  it('reflects created assignments when listing chores', async () => {
    const chore = await postChore({ name: 'Empty dishwasher', type: 'single-time', zoneIds: [] });

    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    const response = await request(app)
      .get(`/api/households/${head.householdId}/chores`)
      .set('Cookie', member.cookie);

    const listed = (response.body.chores as { id: number; assignments: unknown }[]).find(
      (candidate) => candidate.id === chore.id,
    );
    expect(listed?.assignments).toEqual([
      {
        id: expect.any(Number),
        userId: memberId,
        username: 'assign-member',
        zoneId: null,
      },
    ]);
  });
});

describe('DELETE /api/households/:householdId/chores/:choreId/assignments/:assignmentId', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;
  let otherMember: Awaited<ReturnType<typeof registerAndJoin>>;
  let memberId: number;
  let otherMemberId: number;
  let kitchenZoneId: number;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('unassign-hoh@example.com', 'Unassign House');
    member = await registerAndJoin('unassign-member@example.com', head.joinCode);
    otherMember = await registerAndJoin('unassign-member-2@example.com', head.joinCode);
    memberId = await meId(member.cookie);
    otherMemberId = await meId(otherMember.cookie);
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    kitchenZoneId = await createZone(head.householdId, head.cookie, 'Kitchen', rootZoneId);
  });

  async function meId(cookie: string): Promise<number> {
    const response = await request(app).get('/api/auth/me').set('Cookie', cookie);
    return response.body.user.id;
  }

  async function postChore(body: Record<string, unknown>) {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send(body);
    return response.body.chore;
  }

  async function assign(choreId: number, cookie: string, body: Record<string, unknown>) {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${choreId}/assignments`)
      .set('Cookie', cookie)
      .send(body);
    return response.body.chore;
  }

  it('lets a member unassign their own whole-chore assignment', async () => {
    const chore = await postChore({ name: 'Vacuum', type: 'single-time', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.chore.assignments).toEqual([]);
  });

  it('lets a member unassign their own zone-scoped assignment', async () => {
    const chore = await postChore({ name: 'Wash dishes', type: 'single-time', zoneIds: [kitchenZoneId] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId, zoneId: kitchenZoneId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.chore.assignments).toEqual([]);
  });

  it('lets the head unassign someone else', async () => {
    const chore = await postChore({ name: 'Mop floor', type: 'single-time', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    expect(response.body.chore.assignments).toEqual([]);
  });

  it('rejects a member unassigning someone else with 403', async () => {
    const chore = await postChore({ name: 'Take out trash', type: 'single-time', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: otherMemberId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('CannotUnassignOthers');

    const stillThere = await request(app)
      .get(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie);
    const listed = (stillThere.body.chores as { id: number; assignments: unknown[] }[]).find(
      (candidate) => candidate.id === chore.id,
    );
    expect(listed?.assignments).toHaveLength(1);
  });

  it('rejects a non-existent assignment id with 404', async () => {
    const chore = await postChore({ name: 'Clean windows', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/999999`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ChoreAssignmentNotFound');
  });

  it('rejects an assignment id that belongs to a different chore with 404', async () => {
    const choreA = await postChore({ name: 'Dust shelves', type: 'single-time', zoneIds: [] });
    const choreB = await postChore({ name: 'Sweep porch', type: 'single-time', zoneIds: [] });
    const assignedA = await assign(choreA.id, head.cookie, { userId: memberId });
    const assignmentId = assignedA.assignments[0].id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${choreB.id}/assignments/${assignmentId}`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ChoreAssignmentNotFound');
  });

  it('rejects a non-existent chore id with 404', async () => {
    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/999999/assignments/1`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ChoreNotFound');
  });

  it('rejects a non-member of the household with a generic 404', async () => {
    const chore = await postChore({ name: 'Water plants', type: 'single-time', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId });
    const assignmentId = assigned.assignments[0].id;
    const outsider = await registerHeadOfHousehold('unassign-outsider@example.com', 'Outsider House');

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', outsider.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const chore = await postChore({ name: 'Feed the cat', type: 'single-time', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app).delete(
      `/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`,
    );

    expect(response.status).toBe(401);
  });

  it('allows re-assigning the same target after unassigning it', async () => {
    const chore = await postChore({ name: 'Iron shirts', type: 'single-time', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId });
    const assignmentId = assigned.assignments[0].id;

    await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', head.cookie);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    expect(response.status).toBe(201);
    expect(response.body.chore.assignments).toHaveLength(1);
  });
});

describe('PATCH /api/households/:householdId/chores/:choreId/status', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;
  let kitchenZoneId: number;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('status-hoh@example.com', 'Status House');
    member = await registerAndJoin('status-member@example.com', head.joinCode);
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    kitchenZoneId = await createZone(head.householdId, head.cookie, 'Kitchen', rootZoneId);
  });

  async function postChore(body: Record<string, unknown>) {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send(body);
    return response.body.chore;
  }

  it('lets a member mark a zoneless chore complete, and back to to-do', async () => {
    const chore = await postChore({ name: 'Vacuum', type: 'single-time', zoneIds: [] });

    const completed = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'complete' });

    expect(completed.status).toBe(200);
    expect(completed.body.chore.status).toBe('complete');

    const reverted = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'to-do' });

    expect(reverted.status).toBe(200);
    expect(reverted.body.chore.status).toBe('to-do');
  });

  it('rejects setting status on a chore that has zones with 400', async () => {
    const chore = await postChore({
      name: 'Wash dishes',
      type: 'single-time',
      zoneIds: [kitchenZoneId],
    });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ChoreStatusManagedByZones');
  });

  it('rejects an invalid status value with 400', async () => {
    const chore = await postChore({ name: 'Mop floor', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'overdue' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects a non-existent chore id with 404', async () => {
    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/999999/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ChoreNotFound');
  });

  it('rejects a non-member of the household with a generic 404', async () => {
    const chore = await postChore({ name: 'Dust shelves', type: 'single-time', zoneIds: [] });
    const outsider = await registerHeadOfHousehold('status-outsider@example.com', 'Outsider House');

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', outsider.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const chore = await postChore({ name: 'Feed the cat', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .send({ status: 'complete' });

    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/households/:householdId/chores/:choreId/zones/:zoneId/status', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;
  let kitchenZoneId: number;
  let bathroomZoneId: number;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('zonestatus-hoh@example.com', 'Zone Status House');
    member = await registerAndJoin('zonestatus-member@example.com', head.joinCode);
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    kitchenZoneId = await createZone(head.householdId, head.cookie, 'Kitchen', rootZoneId);
    bathroomZoneId = await createZone(head.householdId, head.cookie, 'Bathroom', rootZoneId);
  });

  async function postChore(body: Record<string, unknown>) {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send(body);
    return response.body.chore;
  }

  it('lets a member mark one of a chore’s zones complete', async () => {
    const chore = await postChore({
      name: 'Wash dishes',
      type: 'single-time',
      zoneIds: [kitchenZoneId],
    });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(200);
    expect(response.body.chore.zones).toEqual([{ zoneId: kitchenZoneId, status: 'complete' }]);
    expect(response.body.chore.status).toBe('complete');
  });

  it('keeps the chore at to-do until every zone is complete', async () => {
    const chore = await postChore({
      name: 'Deep clean',
      type: 'single-time',
      zoneIds: [kitchenZoneId, bathroomZoneId],
    });

    const afterFirst = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'complete' });
    expect(afterFirst.body.chore.status).toBe('to-do');

    const afterSecond = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${bathroomZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'complete' });
    expect(afterSecond.body.chore.status).toBe('complete');
  });

  it('rejects a zone that is not one of the chore’s zones with 400', async () => {
    const chore = await postChore({ name: 'Sweep', type: 'single-time', zoneIds: [] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ChoreZoneMismatch');
  });

  it('rejects a non-existent chore id with 404', async () => {
    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/999999/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ChoreNotFound');
  });

  it('rejects a non-member of the household with a generic 404', async () => {
    const chore = await postChore({
      name: 'Water plants',
      type: 'single-time',
      zoneIds: [kitchenZoneId],
    });
    const outsider = await registerHeadOfHousehold(
      'zonestatus-outsider@example.com',
      'Outsider House',
    );

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', outsider.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const chore = await postChore({
      name: 'Take out recycling',
      type: 'single-time',
      zoneIds: [kitchenZoneId],
    });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .send({ status: 'complete' });

    expect(response.status).toBe(401);
  });
});
