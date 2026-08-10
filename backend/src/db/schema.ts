import { sqliteTable, text, integer, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const HOUSEHOLD_ROLES = ['member', 'head'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const households = sqliteTable('households', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  joinCode: text('join_code').notNull().unique(),
  // The user who created this household — permanently immune to demotion (see
  // householdService.demoteMember). `users` is defined further down this file, hence
  // the lazy callback, same pattern as zones' self-reference below.
  createdByUserId: integer('created_by_user_id')
    .notNull()
    .references((): AnySQLiteColumn => users.id),
  createdAt: integer('created_at').notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
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

// 'overdue' is set manually by a Head of Household for now (see choreService) — it
// isn't yet computed automatically from due dates, but the column already supports
// that future behavior without another migration.
export const CHORE_STATUSES = ['to-do', 'complete', 'overdue'] as const;
export type ChoreStatus = (typeof CHORE_STATUSES)[number];

export const chores = sqliteTable('chores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Only meaningful when the chore has no zones — a chore with zones takes its status
  // from them instead (see choreService.deriveChoreStatus).
  status: text('status', { enum: CHORE_STATUSES }).notNull().default('to-do'),
  createdAt: integer('created_at').notNull(),
});

export const choreZones = sqliteTable(
  'chore_zones',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    choreId: integer('chore_id')
      .notNull()
      .references(() => chores.id, { onDelete: 'cascade' }),
    zoneId: integer('zone_id')
      .notNull()
      .references(() => zones.id, { onDelete: 'cascade' }),
    status: text('status', { enum: CHORE_STATUSES }).notNull().default('to-do'),
  },
  (table) => [unique().on(table.choreId, table.zoneId)],
);

export const choreAssignments = sqliteTable('chore_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  choreId: integer('chore_id')
    .notNull()
    .references(() => chores.id, { onDelete: 'cascade' }),
  // NULL means the chore itself, not scoped to one of its zones.
  zoneId: integer('zone_id').references(() => zones.id, { onDelete: 'cascade' }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
