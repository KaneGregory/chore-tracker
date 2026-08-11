import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-push-routes-'));
process.env.DB_FILE = join(testDir, 'test.db');
process.env.SESSION_TTL_DAYS = '30';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.VAPID_SUBJECT = 'mailto:test@example.com';

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

async function register(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      username: email.split('@')[0],
      password: 'correct-horse-battery',
      household: { mode: 'create', name: `${email}'s House` },
    });
  return cookieFrom(response);
}

describe('GET /api/push/public-key', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).get('/api/push/public-key');
    expect(response.status).toBe(401);
  });

  it('returns the configured VAPID public key', async () => {
    const cookie = await register('push-key@example.com');

    const response = await request(app).get('/api/push/public-key').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ publicKey: 'test-public-key' });
  });
});

describe('POST /api/push/subscribe', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post('/api/push/subscribe')
      .send({ endpoint: 'https://push.example.com/a', keys: { p256dh: 'a', auth: 'a' } });
    expect(response.status).toBe(401);
  });

  it('stores a valid subscription', async () => {
    const cookie = await register('push-subscribe@example.com');

    const response = await request(app)
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({
        endpoint: 'https://push.example.com/subscribe-1',
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
        timezone: 'America/New_York',
      });

    expect(response.status).toBe(204);
  });

  it('rejects a subscription missing keys with 400', async () => {
    const cookie = await register('push-subscribe-invalid@example.com');

    const response = await request(app)
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'https://push.example.com/subscribe-2', timezone: 'America/New_York' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects a non-URL endpoint with 400', async () => {
    const cookie = await register('push-subscribe-bad-endpoint@example.com');

    const response = await request(app)
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint: 'not-a-url', keys: { p256dh: 'a', auth: 'a' }, timezone: 'America/New_York' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  it('rejects an invalid time zone with 400', async () => {
    const cookie = await register('push-subscribe-bad-timezone@example.com');

    const response = await request(app)
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({
        endpoint: 'https://push.example.com/subscribe-3',
        keys: { p256dh: 'a', auth: 'a' },
        timezone: 'Mars/Olympus_Mons',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });

  // notifyUser later sends a real request to this endpoint (pushService.ts) —
  // rejecting non-public hosts here is what stops a member from turning the server
  // into an SSRF proxy against internal services via their own push subscription.
  it.each([
    ['http://push.example.com/insecure', 0],
    ['https://localhost/subscribe', 1],
    ['https://127.0.0.1/subscribe', 2],
    ['https://192.168.1.5/subscribe', 3],
    ['https://169.254.169.254/latest/meta-data/', 4],
  ])('rejects a non-public endpoint (%s) with 400', async (endpoint, index) => {
    const cookie = await register(`push-ssrf-${index}@example.com`);

    const response = await request(app)
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint, keys: { p256dh: 'a', auth: 'a' }, timezone: 'America/New_York' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
});

describe('POST /api/push/unsubscribe', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app)
      .post('/api/push/unsubscribe')
      .send({ endpoint: 'https://push.example.com/a' });
    expect(response.status).toBe(401);
  });

  it('removes a subscription the caller previously created', async () => {
    const cookie = await register('push-unsubscribe@example.com');
    const endpoint = 'https://push.example.com/unsubscribe-1';
    await request(app)
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send({ endpoint, keys: { p256dh: 'a', auth: 'a' }, timezone: 'America/New_York' });

    const response = await request(app)
      .post('/api/push/unsubscribe')
      .set('Cookie', cookie)
      .send({ endpoint });

    expect(response.status).toBe(204);
  });

  it('does not remove a subscription owned by someone else, though it still reports 204', async () => {
    const owner = await register('push-unsubscribe-owner@example.com');
    const intruder = await register('push-unsubscribe-intruder@example.com');
    const endpoint = 'https://push.example.com/unsubscribe-2';
    await request(app)
      .post('/api/push/subscribe')
      .set('Cookie', owner)
      .send({ endpoint, keys: { p256dh: 'a', auth: 'a' }, timezone: 'America/New_York' });

    const response = await request(app)
      .post('/api/push/unsubscribe')
      .set('Cookie', intruder)
      .send({ endpoint });
    expect(response.status).toBe(204);

    const row = sqlite
      .prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
      .get(endpoint);
    expect(row).toBeDefined();
  });
});
