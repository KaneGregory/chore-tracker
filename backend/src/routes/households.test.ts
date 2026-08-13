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

// Joins are 'pending' until a head approves them (see registerPending for a raw
// join, used by the pending/approve/decline/assign tests themselves) — this helper
// additionally approves, so every *other* test gets the normal active member it
// depended on before that concept existed.
async function registerAndJoin(
  email: string,
  head: { cookie: string; householdId: number; joinCode: string },
) {
  const { cookie, userId } = await registerPending(email, head.joinCode);
  await request(app)
    .post(`/api/households/${head.householdId}/members/${userId}/approve`)
    .set('Cookie', head.cookie);
  return { cookie, userId };
}

async function registerPending(email: string, joinCode: string) {
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
    member = await registerAndJoin('member@example.com', head);
  });

  it('lists members in join order with their roles', async () => {
    const response = await request(app)
      .get(`/api/households/${head.householdId}/members`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    expect(response.body.members).toEqual([
      { id: head.userId, username: 'hoh', role: 'head', status: 'active', isCreator: true, hasAccount: true },
      { id: member.userId, username: 'member', role: 'member', status: 'active', isCreator: false, hasAccount: true },
    ]);
  });

  it('is visible to any member of the household, not just the head', async () => {
    const response = await request(app)
      .get(`/api/households/${head.householdId}/members`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.members).toHaveLength(2);
  });

  it('shows a pending applicant to the head, but not to an active member', async () => {
    const applicant = await registerPending('pending-applicant@example.com', head.joinCode);

    const headView = await request(app)
      .get(`/api/households/${head.householdId}/members`)
      .set('Cookie', head.cookie);
    expect(headView.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: applicant.userId, status: 'pending' }),
      ]),
    );

    const memberView = await request(app)
      .get(`/api/households/${head.householdId}/members`)
      .set('Cookie', member.cookie);
    expect(
      memberView.body.members.some((m: { id: number }) => m.id === applicant.userId),
    ).toBe(false);
  });

  it('rejects a pending applicant trying to view the members list themselves', async () => {
    const applicant = await registerPending('self-viewing-applicant@example.com', head.joinCode);

    const response = await request(app)
      .get(`/api/households/${head.householdId}/members`)
      .set('Cookie', applicant.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
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

describe('POST /api/households/:householdId/members', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('create-member-hoh@example.com', 'Create Member House');
    member = await registerAndJoin('create-member-member@example.com', head);
  });

  it('lets the head of household create a member with no account of their own', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members`)
      .set('Cookie', head.cookie)
      .send({ username: 'grandma' });

    expect(response.status).toBe(201);
    const created = response.body.members.find(
      (m: { username: string }) => m.username === 'grandma',
    );
    expect(created).toMatchObject({
      username: 'grandma',
      role: 'member',
      status: 'active',
      isCreator: false,
      hasAccount: false,
    });

    const row = sqlite
      .prepare('SELECT email, password_hash FROM users WHERE id = ?')
      .get(created.id) as { email: string | null; password_hash: string | null };
    expect(row.email).toBeNull();
    expect(row.password_hash).toBeNull();
  });

  it('rejects a duplicate username with 409', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members`)
      .set('Cookie', head.cookie)
      .send({ username: 'grandma' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('UsernameAlreadyTaken');
  });

  it('rejects creation attempts from a member who is not head of household', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members`)
      .set('Cookie', member.cookie)
      .send({ username: 'grandpa' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects an empty username with 400', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members`)
      .set('Cookie', head.cookie)
      .send({ username: '  ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members`)
      .send({ username: 'uncle-joe' });

    expect(response.status).toBe(401);
  });
});

describe('POST /api/households/:householdId/members/:userId/promote', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let memberA: Awaited<ReturnType<typeof registerAndJoin>>;
  let memberB: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('promo-head@example.com', 'Promotion House');
    memberA = await registerAndJoin('promo-a@example.com', head);
    memberB = await registerAndJoin('promo-b@example.com', head);
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
    secondHead = await registerAndJoin('demo-second-head@example.com', creator);
    member = await registerAndJoin('demo-member@example.com', creator);

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

describe('POST /api/households/:householdId/members/:userId/approve', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('approve-hoh@example.com', 'Approve House');
    member = await registerAndJoin('approve-existing-member@example.com', head);
  });

  it('lets the head approve a pending applicant as a new active member', async () => {
    const applicant = await registerPending('approve-applicant@example.com', head.joinCode);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${applicant.userId}/approve`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    const approved = response.body.members.find((m: { id: number }) => m.id === applicant.userId);
    expect(approved).toMatchObject({ role: 'member', status: 'active' });
  });

  it('rejects approval attempts from a member who is not head of household', async () => {
    const applicant = await registerPending('approve-applicant-2@example.com', head.joinCode);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${applicant.userId}/approve`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects approving someone who is already active with 400', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${member.userId}/approve`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ApplicationNotPending');
  });

  it('rejects approving someone who is not a member of the household with 404', async () => {
    const outsider = await registerHeadOfHousehold('approve-outsider@example.com', 'Other House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${outsider.userId}/approve`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('MemberNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const applicant = await registerPending('approve-applicant-3@example.com', head.joinCode);

    const response = await request(app).post(
      `/api/households/${head.householdId}/members/${applicant.userId}/approve`,
    );
    expect(response.status).toBe(401);
  });
});

describe('POST /api/households/:householdId/members/:userId/decline', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('decline-hoh@example.com', 'Decline House');
    member = await registerAndJoin('decline-existing-member@example.com', head);
  });

  it('removes a declined applicant from the household but keeps their account', async () => {
    const applicant = await registerPending('decline-applicant@example.com', head.joinCode);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${applicant.userId}/decline`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    expect(response.body.members.some((m: { id: number }) => m.id === applicant.userId)).toBe(
      false,
    );

    // The account itself survives — they can still log in, just with no households.
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'decline-applicant@example.com', password: 'correct-horse-battery' });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.households).toEqual([]);
  });

  it('rejects decline attempts from a member who is not head of household', async () => {
    const applicant = await registerPending('decline-applicant-2@example.com', head.joinCode);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${applicant.userId}/decline`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects declining someone who is already active with 400', async () => {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${member.userId}/decline`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ApplicationNotPending');
  });

  it('rejects declining someone who is not a member of the household with 404', async () => {
    const outsider = await registerHeadOfHousehold('decline-outsider@example.com', 'Other House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${outsider.userId}/decline`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('MemberNotFound');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const applicant = await registerPending('decline-applicant-3@example.com', head.joinCode);

    const response = await request(app).post(
      `/api/households/${head.householdId}/members/${applicant.userId}/decline`,
    );
    expect(response.status).toBe(401);
  });
});

describe('POST /api/households/:householdId/members/:userId/assign', () => {
  let head: Awaited<ReturnType<typeof registerHeadOfHousehold>>;
  let member: Awaited<ReturnType<typeof registerAndJoin>>;

  beforeAll(async () => {
    head = await registerHeadOfHousehold('assign-hoh@example.com', 'Assign House');
    member = await registerAndJoin('assign-existing-member@example.com', head);
  });

  async function createPlaceholder(username: string): Promise<number> {
    const response = await request(app)
      .post(`/api/households/${head.householdId}/members`)
      .set('Cookie', head.cookie)
      .send({ username });
    return response.body.members.find((m: { username: string }) => m.username === username).id;
  }

  it('merges a pending applicant into an existing account-less member, preserving their chore history', async () => {
    const placeholderId = await createPlaceholder('grandma-placeholder');

    // Give the placeholder a chore assignment before the merge, to confirm it
    // survives under the same id afterward.
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Water the ferns', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;
    await request(app)
      .post(`/api/households/${head.householdId}/chores/${choreId}/assignments`)
      .set('Cookie', head.cookie)
      .send({ userId: placeholderId });

    const applicant = await registerPending('assign-applicant@example.com', head.joinCode);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${applicant.userId}/assign`)
      .set('Cookie', head.cookie)
      .send({ targetMemberId: placeholderId });

    expect(response.status).toBe(200);
    // The applicant's own membership row is gone — merged away, not a separate member.
    expect(response.body.members.some((m: { id: number }) => m.id === applicant.userId)).toBe(
      false,
    );
    const merged = response.body.members.find((m: { id: number }) => m.id === placeholderId);
    expect(merged).toMatchObject({
      username: 'grandma-placeholder',
      hasAccount: true,
      status: 'active',
    });

    // The chore assignment made before the merge still points at the same id.
    const choreCheck = await request(app)
      .get(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie);
    const mergedChore = choreCheck.body.chores.find((c: { id: number }) => c.id === choreId);
    expect(mergedChore.assignments).toEqual([
      expect.objectContaining({ userId: placeholderId, username: 'grandma-placeholder' }),
    ]);

    // The applicant's original credentials now log in as the merged identity.
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'assign-applicant@example.com', password: 'correct-horse-battery' });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.username).toBe('grandma-placeholder');

    // The applicant's session from before the merge still works too — they land on
    // the household as the merged identity instead of being logged out.
    const meResponse = await request(app).get('/api/auth/me').set('Cookie', applicant.cookie);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.username).toBe('grandma-placeholder');
    expect(meResponse.body.households).toEqual([
      expect.objectContaining({ id: head.householdId, role: 'member', status: 'active' }),
    ]);
  });

  it('rejects assigning to a member who already has an account of their own', async () => {
    const applicant = await registerPending('assign-applicant-2@example.com', head.joinCode);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${applicant.userId}/assign`)
      .set('Cookie', head.cookie)
      .send({ targetMemberId: member.userId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('TargetMemberHasAccount');
  });

  it('rejects assignment attempts from a member who is not head of household', async () => {
    const applicant = await registerPending('assign-applicant-3@example.com', head.joinCode);
    const placeholderId = await createPlaceholder('placeholder-for-non-head-test');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${applicant.userId}/assign`)
      .set('Cookie', member.cookie)
      .send({ targetMemberId: placeholderId });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('rejects assigning someone who is already active with 400', async () => {
    const placeholderId = await createPlaceholder('placeholder-for-active-test');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${member.userId}/assign`)
      .set('Cookie', head.cookie)
      .send({ targetMemberId: placeholderId });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ApplicationNotPending');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const applicant = await registerPending('assign-applicant-4@example.com', head.joinCode);
    const placeholderId = await createPlaceholder('placeholder-for-401-test');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/members/${applicant.userId}/assign`)
      .send({ targetMemberId: placeholderId });

    expect(response.status).toBe(401);
  });
});

describe('POST /api/households', () => {
  async function createUserWithNoHousehold(email: string) {
    const host = await registerHeadOfHousehold(`host-${email}`, 'Host Household');
    const applicant = await registerPending(email, host.joinCode);
    await request(app)
      .post(`/api/households/${host.householdId}/members/${applicant.userId}/decline`)
      .set('Cookie', host.cookie);
    return applicant;
  }

  it('lets an authenticated user with no household create a new one, as its active head', async () => {
    const user = await createUserWithNoHousehold('onboard-create@example.com');

    const response = await request(app)
      .post('/api/households')
      .set('Cookie', user.cookie)
      .send({ mode: 'create', name: 'Fresh Start House' });

    expect(response.status).toBe(201);
    expect(response.body.household).toMatchObject({
      name: 'Fresh Start House',
      role: 'head',
      status: 'active',
    });
  });

  it('lets an authenticated user with no household join an existing one as a pending applicant', async () => {
    const host = await registerHeadOfHousehold('onboard-host@example.com', 'Onboard Host House');
    const user = await createUserWithNoHousehold('onboard-join@example.com');

    const response = await request(app)
      .post('/api/households')
      .set('Cookie', user.cookie)
      .send({ mode: 'join', joinCode: host.joinCode });

    expect(response.status).toBe(201);
    expect(response.body.household).toMatchObject({
      id: host.householdId,
      role: 'member',
      status: 'pending',
    });
  });

  it('rejects an invalid join code with 400', async () => {
    const user = await createUserWithNoHousehold('onboard-invalid@example.com');

    const response = await request(app)
      .post('/api/households')
      .set('Cookie', user.cookie)
      .send({ mode: 'join', joinCode: 'ZZZZ-ZZZZ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('InvalidJoinCode');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post('/api/households')
      .send({ mode: 'create', name: 'Nope House' });

    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/households/:householdId/timezone', () => {
  it('lets any active member set the household timezone', async () => {
    const head = await registerHeadOfHousehold('tz-hoh@example.com', 'Timezone House');
    const member = await registerAndJoin('tz-member@example.com', head);

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/timezone`)
      .set('Cookie', member.cookie)
      .send({ timezone: 'America/New_York' });

    expect(response.status).toBe(204);
  });

  it('rejects an invalid timezone name', async () => {
    const head = await registerHeadOfHousehold('tz-invalid-hoh@example.com', 'Invalid TZ House');

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/timezone`)
      .set('Cookie', head.cookie)
      .send({ timezone: 'Not/AZone' });

    expect(response.status).toBe(400);
  });

  it('rejects a non-member with a generic 404', async () => {
    const head = await registerHeadOfHousehold('tz-outsider-hoh@example.com', 'Outsider TZ House');
    const outsider = await registerHeadOfHousehold('tz-outsider@example.com', 'Outsider TZ House 2');

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/timezone`)
      .set('Cookie', outsider.cookie)
      .send({ timezone: 'UTC' });

    expect(response.status).toBe(404);
  });
});
