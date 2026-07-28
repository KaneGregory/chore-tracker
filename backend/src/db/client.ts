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
  migrate(db, { migrationsFolder: './drizzle' });
}
