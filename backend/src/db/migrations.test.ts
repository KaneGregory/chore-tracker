import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-migrations-'));
process.env.DB_FILE = join(testDir, 'test.db');

const { runMigrations, sqlite } = await import('./client.js');

beforeAll(() => {
  runMigrations();
});

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

function tableNames(): string[] {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe('migrations', () => {
  it('creates all four application tables', () => {
    const names = tableNames();
    expect(names).toEqual(
      expect.arrayContaining(['households', 'users', 'household_members', 'sessions']),
    );
  });

  it('enforces a unique index on households.join_code', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(households)').all() as Array<{
      name: string;
      unique: number;
    }>;
    const joinCodeIndex = indexes.find((i) => i.name.includes('join_code'));
    expect(joinCodeIndex?.unique).toBe(1);
  });

  it('enforces a unique index on users.email', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(users)').all() as Array<{
      name: string;
      unique: number;
    }>;
    const emailIndex = indexes.find((i) => i.name.includes('email'));
    expect(emailIndex?.unique).toBe(1);
  });

  it('enforces a unique index on users.username', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(users)').all() as Array<{
      name: string;
      unique: number;
    }>;
    const usernameIndex = indexes.find((i) => i.name.includes('username'));
    expect(usernameIndex?.unique).toBe(1);
  });

  it('enforces a composite unique index on household_members(user_id, household_id)', () => {
    const indexes = sqlite.prepare('PRAGMA index_list(household_members)').all() as Array<{
      name: string;
      unique: number;
    }>;
    const uniqueComposite = indexes.find((i) => i.unique === 1);
    expect(uniqueComposite).toBeDefined();
    const columns = sqlite.prepare(`PRAGMA index_info(${uniqueComposite!.name})`).all() as Array<{
      name: string;
    }>;
    expect(columns.map((c) => c.name).sort()).toEqual(['household_id', 'user_id']);
  });

  it('cascades household_members deletion when the referenced user is deleted', () => {
    const foreignKeys = sqlite
      .prepare('PRAGMA foreign_key_list(household_members)')
      .all() as Array<{
      table: string;
      on_delete: string;
    }>;
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'users', on_delete: 'CASCADE' }),
        expect.objectContaining({ table: 'households', on_delete: 'CASCADE' }),
      ]),
    );
  });
});
