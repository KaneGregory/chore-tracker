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

describe('POST /api/auth/register', () => {
  it('registers a new user and creates a household', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'Alice@Example.com',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'The Smiths' },
      });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe('alice@example.com');
    expect(response.body.households).toEqual([
      { id: expect.any(Number), name: 'The Smiths', joinCode: expect.any(String) },
    ]);
    expect(response.headers['set-cookie']).toBeDefined();
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'bob@example.com',
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Bob House' },
      });

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'bob@example.com',
        password: 'another-password',
        household: { mode: 'create', name: 'Other House' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('EmailAlreadyRegistered');
  });

  it('rejects an invalid join code with 400 without leaking which part was wrong', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'carol@example.com',
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
        password: 'correct-horse-battery',
        household: { mode: 'create', name: 'Dave House' },
      });

    const lowercased: string = created.body.households[0].joinCode.toLowerCase();
    const lowercaseHyphenatedCode = `${lowercased.slice(0, 4)}-${lowercased.slice(4)}`;

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'erin@example.com',
        password: 'correct-horse-battery',
        household: { mode: 'join', joinCode: lowercaseHyphenatedCode },
      });

    expect(response.status).toBe(201);
    expect(response.body.households[0].id).toBe(created.body.households[0].id);
  });

  it('rejects a password shorter than 8 characters with a 400 validation error', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'frank@example.com',
        password: 'short',
        household: { mode: 'create', name: 'X' },
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
