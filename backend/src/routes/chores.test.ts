import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

// Chore mutations queue debounced push notifications via notificationBatcher.ts —
// mocked here so these tests assert *that* the right person gets queued (synchronous,
// within the request) without waiting out the real debounce delay or touching
// web-push/VAPID, both covered separately (notificationBatcher.test.ts,
// pushService.test.ts).
vi.mock('../services/notificationBatcher.js', () => ({
  queueOverdueNotification: vi.fn(),
  queueReopenedNotification: vi.fn(),
  queueAssignmentNotification: vi.fn(),
}));
const { queueOverdueNotification, queueReopenedNotification, queueAssignmentNotification } =
  await import('../services/notificationBatcher.js');

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

// Joins are 'pending' until a head approves them — this helper additionally
// approves, so callers get the normal active member they depended on before that
// concept existed.
async function registerAndJoin(
  email: string,
  head: { cookie: string; householdId: number; joinCode: string },
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
    member = await registerAndJoin('chores-member@example.com', head);
    rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    kitchenZoneId = await createZone(head.householdId, head.cookie, 'Kitchen', rootZoneId);
  });

  it('lets the head create a chore with no zones', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Take out trash', zoneIds: [] });

    expect(response.status).toBe(201);
    expect(response.body.chore).toEqual({
      id: expect.any(Number),
      name: 'Take out trash',
      status: 'to-do',
      zones: [],
      assignments: [],
    });
  });

  it('lets the head create a chore with no zoneIds field at all', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Water the plants' });

    expect(response.status).toBe(201);
    expect(response.body.chore.zones).toEqual([]);
  });

  it('assigns a chore to a single zone', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Wash dishes', zoneIds: [kitchenZoneId] });

    expect(response.status).toBe(201);
    expect(response.body.chore.zones).toEqual([{ zoneId: kitchenZoneId, status: 'to-do' }]);
  });

  it('assigns a chore to multiple zones', async () => {
    const bathroomZoneId = await createZone(head.householdId, head.cookie, 'Bathroom', rootZoneId);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Deep clean', zoneIds: [kitchenZoneId, bathroomZoneId] });

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
      .send({ name: 'Sweep floor', zoneIds: [kitchenZoneId, kitchenZoneId] });

    expect(response.status).toBe(201);
    expect(response.body.chore.zones).toEqual([{ zoneId: kitchenZoneId, status: 'to-do' }]);
  });

  it('rejects a non-head member with 403', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', member.cookie)
      .send({ name: 'Mow the lawn', zoneIds: [] });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a non-member with a generic 404', async () => {
    const outsider = await registerHeadOfHousehold('chores-outsider@example.com', 'Outsider House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', outsider.cookie)
      .send({ name: 'Not allowed', zoneIds: [] });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects a zone id belonging to a different household with 404', async () => {
    const other = await registerHeadOfHousehold('chores-other@example.com', 'Other House');
    const otherRootId = await getRootZoneId(other.householdId, other.cookie);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Cross household', zoneIds: [otherRootId] });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ZoneNotFound');
  });

  it('rejects an empty chore name with 400', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: '   ', zoneIds: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .send({ name: 'Nope', zoneIds: [] });

    expect(response.status).toBe(401);
  });
});

describe('GET /api/households/:householdId/chores', () => {
  it('is visible to any member and reflects assigned zones', async () => {
    const head = await registerHeadOfHousehold('chores-list-hoh@example.com', 'List House');
    const member = await registerAndJoin('chores-list-member@example.com', head);
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);

    await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Vacuum', zoneIds: [rootZoneId] });

    const response = await request(app)
      .get(`/api/households/${head.householdId}/chores`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.chores).toEqual([
      {
        id: expect.any(Number),
        name: 'Vacuum',
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

describe('DELETE /api/households/:householdId/chores/:choreId', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('remove-hoh@example.com', 'Remove House');
    member = await registerAndJoin('remove-member@example.com', head);
  });

  async function postChore(body: Record<string, unknown>) {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send(body);
    return response.body.chore;
  }

  it('lets the head remove a chore', async () => {
    const keep = await postChore({ name: 'Keep me', zoneIds: [] });
    const remove = await postChore({ name: 'Remove me', zoneIds: [] });

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${remove.id}`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    const ids = (response.body.chores as { id: number }[]).map((chore) => chore.id);
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(remove.id);
  });

  it('also removes the chore’s assignments and zone links', async () => {
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    const zoneId = await createZone(head.householdId, head.cookie, 'Cascade Zone', rootZoneId);
    const chore = await postChore({ name: 'Cascade chore', zoneIds: [zoneId] });
    const meResponse = await request(app).get('/api/auth/me').set('Cookie', member.cookie);
    const memberId = meResponse.body.user.id;
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    const ids = (response.body.chores as { id: number }[]).map((c) => c.id);
    expect(ids).not.toContain(chore.id);
  });

  it('rejects a non-head member with 403', async () => {
    const chore = await postChore({ name: 'Not yours', zoneIds: [] });

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects a non-existent chore id with 404', async () => {
    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/999999`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ChoreNotFound');
  });

  it('rejects a non-member of the household with a generic 404', async () => {
    const chore = await postChore({ name: 'Outsider target', zoneIds: [] });
    const outsider = await registerHeadOfHousehold('remove-outsider@example.com', 'Outsider House');

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}`)
      .set('Cookie', outsider.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const chore = await postChore({ name: 'No cookie', zoneIds: [] });

    const response = await request(app).delete(`/api/households/${head.householdId}/chores/${chore.id}`);

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
    member = await registerAndJoin('assign-member@example.com', head);
    otherMember = await registerAndJoin('assign-member-2@example.com', head);
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

  it('lets a member assign a chore to themself', async () => {
    const chore = await postChore({ name: 'Vacuum', zoneIds: [] });

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

  it('does not notify when a member assigns a chore to themself', async () => {
    const chore = await postChore({ name: 'Fold laundry', zoneIds: [] });
    vi.mocked(queueAssignmentNotification).mockClear();

    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId });

    expect(queueAssignmentNotification).not.toHaveBeenCalled();
  });

  it('notifies the assignee when someone else assigns them a chore', async () => {
    const chore = await postChore({ name: 'Take out recycling', zoneIds: [] });
    vi.mocked(queueAssignmentNotification).mockClear();

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    expect(response.status).toBe(201);
    expect(queueAssignmentNotification).toHaveBeenCalledWith(
      memberId,
      chore.id,
      null,
      'Take out recycling',
    );
  });

  it('lets a head assign a chore to an account-less member, exactly like any other member', async () => {
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/members`)
      .set('Cookie', head.cookie)
      .send({ username: 'toddler' });
    const accountLessMemberId = createResponse.body.members.find(
      (m: { username: string }) => m.username === 'toddler',
    ).id;

    const chore = await postChore({ name: 'Nap time', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: accountLessMemberId });

    expect(response.status).toBe(201);
    expect(response.body.chore.assignments).toEqual([
      {
        id: expect.any(Number),
        userId: accountLessMemberId,
        username: 'toddler',
        zoneId: null,
      },
    ]);
  });

  it('lets a member assign a chore scoped to one of its zones', async () => {
    const chore = await postChore({ name: 'Wash dishes', zoneIds: [kitchenZoneId] });

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
    const chore = await postChore({ name: 'Take out trash', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: otherMemberId });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('CannotAssignOthers');
  });

  it('lets the head assign a chore to any member', async () => {
    const chore = await postChore({ name: 'Mop floor', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId });

    expect(response.status).toBe(201);
    expect(response.body.chore.assignments[0]).toEqual(
      expect.objectContaining({ userId: memberId, zoneId: null }),
    );
  });

  it('rejects a zone that is not one of the chore’s zones with 400', async () => {
    const chore = await postChore({ name: 'Sweep', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: memberId, zoneId: kitchenZoneId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ChoreZoneMismatch');
  });

  it('lets multiple different members be assigned to the same chore/zone target', async () => {
    const chore = await postChore({ name: 'Fold laundry', zoneIds: [] });

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
    const chore = await postChore({ name: 'Scrub tub', zoneIds: [] });

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
    const chore = await postChore({ name: 'Clean windows', zoneIds: [] });
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
    const chore = await postChore({ name: 'Dust shelves', zoneIds: [] });
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
    const chore = await postChore({ name: 'Take out recycling', zoneIds: [] });

    const response = await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .send({ userId: memberId });

    expect(response.status).toBe(401);
  });

  it('reflects created assignments when listing chores', async () => {
    const chore = await postChore({ name: 'Empty dishwasher', zoneIds: [] });

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
    member = await registerAndJoin('unassign-member@example.com', head);
    otherMember = await registerAndJoin('unassign-member-2@example.com', head);
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
    const chore = await postChore({ name: 'Vacuum', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.chore.assignments).toEqual([]);
  });

  it('lets a member unassign their own zone-scoped assignment', async () => {
    const chore = await postChore({ name: 'Wash dishes', zoneIds: [kitchenZoneId] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId, zoneId: kitchenZoneId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.chore.assignments).toEqual([]);
  });

  it('lets the head unassign someone else', async () => {
    const chore = await postChore({ name: 'Mop floor', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    expect(response.body.chore.assignments).toEqual([]);
  });

  it('rejects a member unassigning someone else with 403', async () => {
    const chore = await postChore({ name: 'Take out trash', zoneIds: [] });
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
    const chore = await postChore({ name: 'Clean windows', zoneIds: [] });

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${chore.id}/assignments/999999`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('ChoreAssignmentNotFound');
  });

  it('rejects an assignment id that belongs to a different chore with 404', async () => {
    const choreA = await postChore({ name: 'Dust shelves', zoneIds: [] });
    const choreB = await postChore({ name: 'Sweep porch', zoneIds: [] });
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
    const chore = await postChore({ name: 'Water plants', zoneIds: [] });
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
    const chore = await postChore({ name: 'Feed the cat', zoneIds: [] });
    const assigned = await assign(chore.id, head.cookie, { userId: memberId });
    const assignmentId = assigned.assignments[0].id;

    const response = await request(app).delete(
      `/api/households/${head.householdId}/chores/${chore.id}/assignments/${assignmentId}`,
    );

    expect(response.status).toBe(401);
  });

  it('allows re-assigning the same target after unassigning it', async () => {
    const chore = await postChore({ name: 'Iron shirts', zoneIds: [] });
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
    member = await registerAndJoin('status-member@example.com', head);
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
    const chore = await postChore({ name: 'Vacuum', zoneIds: [] });

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
    const chore = await postChore({ name: 'Mop floor', zoneIds: [] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'archived' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('lets a head mark a zoneless chore overdue', async () => {
    const chore = await postChore({ name: 'Scrub tub', zoneIds: [] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'overdue' });

    expect(response.status).toBe(200);
    expect(response.body.chore.status).toBe('overdue');
  });

  it('notifies assigned members when a chore becomes overdue', async () => {
    const chore = await postChore({ name: 'Clean gutters', zoneIds: [] });
    const memberId = (await request(app).get('/api/auth/me').set('Cookie', member.cookie)).body
      .user.id;
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId });
    vi.mocked(queueOverdueNotification).mockClear();

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'overdue' });

    expect(response.status).toBe(200);
    expect(queueOverdueNotification).toHaveBeenCalledWith(memberId, chore.id, null, 'Clean gutters');
  });

  it('notifies assigned members when a completed chore is reopened back to to-do', async () => {
    const chore = await postChore({ name: 'Water plants', zoneIds: [] });
    const memberId = (await request(app).get('/api/auth/me').set('Cookie', member.cookie)).body
      .user.id;
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId });
    await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'complete' });
    vi.mocked(queueReopenedNotification).mockClear();

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'to-do' });

    expect(response.status).toBe(200);
    expect(queueReopenedNotification).toHaveBeenCalledWith(memberId, chore.id, null, 'Water plants');
  });

  it('does not notify on a fresh to-do chore (only on complete-to-to-do transitions)', async () => {
    const chore = await postChore({ name: 'Sweep porch', zoneIds: [] });
    const memberId = (await request(app).get('/api/auth/me').set('Cookie', member.cookie)).body
      .user.id;
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId });
    vi.mocked(queueReopenedNotification).mockClear();

    // Already 'to-do' — setting it to 'to-do' again is not a completion→reopen.
    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'to-do' });

    expect(response.status).toBe(200);
    expect(queueReopenedNotification).not.toHaveBeenCalled();
  });

  it('does not notify the member who reopens their own chore', async () => {
    const chore = await postChore({ name: 'Fold towels', zoneIds: [] });
    const memberId = (await request(app).get('/api/auth/me').set('Cookie', member.cookie)).body
      .user.id;
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId });
    await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'complete' });
    vi.mocked(queueReopenedNotification).mockClear();

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'to-do' });

    expect(response.status).toBe(200);
    expect(queueReopenedNotification).not.toHaveBeenCalled();
  });

  it('rejects a member marking a chore overdue with 403', async () => {
    const chore = await postChore({ name: 'Empty dishwasher', zoneIds: [] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'overdue' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('lets a member mark an overdue chore complete', async () => {
    const chore = await postChore({ name: 'Wipe counters', zoneIds: [] });
    await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'overdue' });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(200);
    expect(response.body.chore.status).toBe('complete');
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
    const chore = await postChore({ name: 'Dust shelves', zoneIds: [] });
    const outsider = await registerHeadOfHousehold('status-outsider@example.com', 'Outsider House');

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/status`)
      .set('Cookie', outsider.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const chore = await postChore({ name: 'Feed the cat', zoneIds: [] });

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
    member = await registerAndJoin('zonestatus-member@example.com', head);
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
    const chore = await postChore({ name: 'Sweep', zoneIds: [] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ChoreZoneMismatch');
  });

  it('lets a head mark a chore’s zone overdue', async () => {
    const chore = await postChore({ name: 'Scrub grout', zoneIds: [kitchenZoneId] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'overdue' });

    expect(response.status).toBe(200);
    expect(response.body.chore.zones).toEqual([{ zoneId: kitchenZoneId, status: 'overdue' }]);
  });

  it('notifies members assigned to that zone (and to the whole chore) when it becomes overdue', async () => {
    const chore = await postChore({ name: 'Descale kettle', zoneIds: [kitchenZoneId, bathroomZoneId] });
    const memberId = (await request(app).get('/api/auth/me').set('Cookie', member.cookie)).body
      .user.id;
    const otherMember = await registerAndJoin('zonestatus-member-2@example.com', head);
    // Zone-scoped assignment to the zone being marked overdue...
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId, zoneId: kitchenZoneId });
    // ...and a whole-chore assignment to someone else, who should also be notified
    // since a whole-chore assignment covers every one of its zones.
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: otherMember.userId });
    vi.mocked(queueOverdueNotification).mockClear();

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'overdue' });

    expect(response.status).toBe(200);
    const notifiedUserIds = vi.mocked(queueOverdueNotification).mock.calls.map((call) => call[0]);
    expect(new Set(notifiedUserIds)).toEqual(new Set([memberId, otherMember.userId]));
  });

  it('does not notify the head who marks their own assigned zone overdue', async () => {
    const chore = await postChore({ name: 'Wipe mirrors', zoneIds: [kitchenZoneId] });
    const headId = (await request(app).get('/api/auth/me').set('Cookie', head.cookie)).body.user
      .id;
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: headId, zoneId: kitchenZoneId });
    vi.mocked(queueOverdueNotification).mockClear();

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'overdue' });

    expect(response.status).toBe(200);
    expect(queueOverdueNotification).not.toHaveBeenCalled();
  });

  it('notifies assigned members when a completed zone is reopened back to to-do', async () => {
    const chore = await postChore({ name: 'Restock towels', zoneIds: [kitchenZoneId] });
    const memberId = (await request(app).get('/api/auth/me').set('Cookie', member.cookie)).body
      .user.id;
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${chore.id}/assignments`)
      .set('Cookie', member.cookie)
      .send({ userId: memberId, zoneId: kitchenZoneId });
    await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'complete' });
    vi.mocked(queueReopenedNotification).mockClear();

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'to-do' });

    expect(response.status).toBe(200);
    expect(queueReopenedNotification).toHaveBeenCalledWith(
      memberId,
      chore.id,
      kitchenZoneId,
      'Restock towels',
    );
  });

  it('rejects a member marking a chore’s zone overdue with 403', async () => {
    const chore = await postChore({ name: 'Polish taps', zoneIds: [kitchenZoneId] });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'overdue' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('lets a member mark an overdue zone complete', async () => {
    const chore = await postChore({ name: 'Restock soap', zoneIds: [kitchenZoneId] });
    await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', head.cookie)
      .send({ status: 'overdue' });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .set('Cookie', member.cookie)
      .send({ status: 'complete' });

    expect(response.status).toBe(200);
    expect(response.body.chore.zones).toEqual([{ zoneId: kitchenZoneId, status: 'complete' }]);
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
      zoneIds: [kitchenZoneId],
    });

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/chores/${chore.id}/zones/${kitchenZoneId}/status`)
      .send({ status: 'complete' });

    expect(response.status).toBe(401);
  });
});
