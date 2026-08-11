import { sqliteTable, text, integer, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const HOUSEHOLD_ROLES = ['member', 'head'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

// A row joining via join code starts 'pending' and has no real household access
// (see membershipAuth.requireMembership) until a Head of Household approves,
// assigns, or declines it (householdService.ts). A household's own creator, and
// anyone a Head creates directly via createMember, start 'active' immediately.
export const HOUSEHOLD_MEMBER_STATUSES = ['pending', 'active'] as const;
export type HouseholdMemberStatus = (typeof HOUSEHOLD_MEMBER_STATUSES)[number];

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
  // Null for a member a Head of Household creates directly (see
  // householdService.createMember) rather than through registration — such a member
  // has no login of their own, and can never log in since there's no email to
  // authenticate with.
  email: text('email').unique(),
  username: text('username').notNull().unique(),
  // Null for the same account-less members as `email` above.
  passwordHash: text('password_hash'),
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
    status: text('status', { enum: HOUSEHOLD_MEMBER_STATUSES }).notNull().default('active'),
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

// A user can have several rows here (one per browser/device they've enabled
// notifications on) — no uniqueness on userId alone, only on endpoint, since a given
// browser subscription is globally unique.
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull(),
});
