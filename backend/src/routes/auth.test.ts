import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-auth-routes-'));
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

function extractSessionCookie(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookie) throw new Error('Expected a session cookie to be set');
  return cookie;
}

describe('GET /api/auth/email-availability', () => {
  it('reports an unused email as available', async () => {
    const response = await request(app).get(
      '/api/auth/email-availability?email=unused@example.com',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: true });
  });

  it('reports a registered email as unavailable, case- and whitespace-insensitively', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'henry@example.com',
        username: 'henry',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Henry House' },
      });

    const response = await request(app).get(
      '/api/auth/email-availability?email=%20Henry%40Example.com%20',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: false });
  });

  it('rejects a malformed email with 400', async () => {
    const response = await request(app).get('/api/auth/email-availability?email=not-an-email');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects a missing email with 400', async () => {
    const response = await request(app).get('/api/auth/email-availability');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});

describe('GET /api/auth/username-availability', () => {
  it('reports an unused username as available', async () => {
    const response = await request(app).get('/api/auth/username-availability?username=unused');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: true });
  });

  it('reports a registered username as unavailable', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'ida@example.com',
        username: 'ida',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Ida House' },
      });

    const response = await request(app).get('/api/auth/username-availability?username=ida');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: false });
  });

  it('rejects a missing username with 400', async () => {
    const response = await request(app).get('/api/auth/username-availability');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});

describe('POST /api/auth/register', () => {
  it('registers a new user and creates a household', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'Alice@Example.com',
        username: 'alice',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'The Smiths' },
      });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe('alice@example.com');
    expect(response.body.user.username).toBe('alice');
    expect(response.body.households).toEqual([
      { id: expect.any(Number), name: 'The Smiths', joinCode: expect.any(String), role: 'head' },
    ]);
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'bob@example.com',
        username: 'bob',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Bob House' },
      });

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'bob@example.com',
        username: 'bob-two',
        password: 'another-password',
        household: { mode: 'create', name: 'Other House' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('EmailAlreadyRegistered');
  });

  it('rejects a duplicate username with 409', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'una@example.com',
        username: 'taken-name',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Una House' },
      });

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'uma@example.com',
        username: 'taken-name',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Uma House' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('UsernameAlreadyTaken');
  });

  it('rejects an invalid join code with 400 without leaking which part was wrong', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'carol@example.com',
        username: 'carol',
        password: 'correct-horse-battery',
        household: { mode: 'join', joinCode: 'ZZZZ-ZZZZ' },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('InvalidJoinCode');
  });

  it('lets a second user join a household created by the first, via a normalized join code', async () => {
    const created = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'dave@example.com',
        username: 'dave',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Dave House' },
      });

    expect(created.body.households[0].role).toBe('head');

    const lowercased: string = created.body.households[0].joinCode.toLowerCase();
    const lowercaseHyphenatedCode = `${lowercased.slice(0, 4)}-${lowercased.slice(4)}`;

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'erin@example.com',
        username: 'erin',
        password: 'correct-horse-battery',
        household: { mode: 'join', joinCode: lowercaseHyphenatedCode },
      });

    expect(response.status).toBe(201);
    expect(response.body.households[0].id).toBe(created.body.households[0].id);
    expect(response.body.households[0].role).toBe('member');
  });

  it('rejects a password shorter than 8 characters with a 400 validation error', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'frank@example.com',
        username: 'frank',
        password: 'short',
        household: { mode: 'create', name: 'X' },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects a missing username with a 400 validation error', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'gus@example.com',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Gus House' },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});

describe('POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout', () => {
  it('supports the full login -> me -> logout -> me cycle', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'grace@example.com',
        username: 'grace',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Grace House' },
      });

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: 'grace@example.com', password: 'correct-horse-battery' });
    expect(loginResponse.status).toBe(200);
    const cookie = extractSessionCookie(loginResponse);

    const meResponse = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.email).toBe('grace@example.com');
    expect(meResponse.body.user.username).toBe('grace');

    const logoutResponse = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutResponse.status).toBe(204);

    const meAfterLogout = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(meAfterLogout.status).toBe(401);
  });

  it('rejects login with the wrong password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'grace@example.com', password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('InvalidCredentials');
  });

  it('returns 401 from /me with no session cookie', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });
});
