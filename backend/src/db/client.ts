import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const dbFile = process.env.DB_FILE ?? './data/chore-tracker.db';
mkdirSync(dirname(dbFile), { recursive: true });

export const sqlite = new Database(dbFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function runMigrations() {
  // Some migrations (e.g. 0009, which relaxes users.email/password_hash to nullable)
  // recreate a table that other tables reference via foreign key, and rely on their
  // own `PRAGMA foreign_keys=OFF` around the drop/rename to avoid a constraint
  // failure. But SQLite ignores a `PRAGMA foreign_keys` change once a transaction is
  // open, and drizzle's migrate() wraps every pending migration in one `BEGIN`/
  // `COMMIT` — so that in-migration PRAGMA is a silent no-op. Toggling it here first,
  // before that transaction starts, is what actually disables enforcement for the
  // migration run; it's restored immediately after for normal app operation.
  sqlite.pragma('foreign_keys = OFF');
  try {
    migrate(db, { migrationsFolder: './drizzle' });
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
}
