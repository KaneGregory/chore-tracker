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

  // Migration 0009 recreates `users` (to make email/password_hash nullable), which
  // requires disabling FK enforcement for that step since other tables reference
  // `users` — runMigrations() does this around the whole migration run, not inside
  // any single migration's own SQL, because a mid-transaction `PRAGMA foreign_keys`
  // change is silently ignored by SQLite (drizzle's migrator wraps every pending
  // migration in one transaction). This regressed once already: it passed against a
  // fresh, empty database (nothing to violate a constraint yet) but broke on startup
  // against a real database with existing rows. These two guard that FK enforcement
  // is unconditionally back on afterward for normal app operation, not left disabled.
  it('leaves foreign key enforcement on after running migrations', () => {
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('genuinely enforces foreign keys after running migrations, not just reports them on', () => {
    expect(() =>
      sqlite
        .prepare(
          'INSERT INTO household_members (user_id, household_id, role, created_at) VALUES (999999, 999999, ?, ?)',
        )
        .run('member', Date.now()),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
