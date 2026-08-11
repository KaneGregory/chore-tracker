import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-app-'));
process.env.DB_FILE = join(testDir, 'test.db');
process.env.CORS_ORIGIN = 'http://localhost:5173';

const { sqlite } = await import('./db/client.js');
const { createApp } = await import('./app.js');
const app = createApp();

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

describe('GET /health', () => {
  it('responds 200 without requiring authentication', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
  });
});
