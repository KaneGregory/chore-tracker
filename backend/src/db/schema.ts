import { sqliteTable, text, integer, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const HOUSEHOLD_ROLES = ['member', 'head'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const households = sqliteTable('households', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  joinCode: text('join_code').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const householdMembers = sqliteTable(
  'household_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    role: text('role', { enum: HOUSEHOLD_ROLES }).notNull().default('member'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [unique().on(table.userId, table.householdId)],
);

export const zones = sqliteTable('zones', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  // NULL only for a household's root zone ("The Household" itself) — every other
  // zone has a parent, and removing a parent cascades to its whole subtree.
  parentZoneId: integer('parent_zone_id').references((): AnySQLiteColumn => zones.id, {
    onDelete: 'cascade',
  }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
