import {
  sqliteTable,
  text,
  integer,
  unique,
  uniqueIndex,
  index,
  check,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

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
  // IANA zone (e.g. "America/New_York"), captured client-side the same way
  // push_subscriptions.timezone is — every chore_schedules row belonging to this
  // household is evaluated against it (see choreScheduler.ts). Null until a member's
  // browser has synced one; schedules fall back to UTC until then.
  timezone: text('timezone'),
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

export const RECURRENCE_TYPES = ['once', 'every_n_days', 'weekly', 'monthly'] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

// Exactly one schedule per chore/chore-zone (see the two partial unique indexes
// below) — setting a new one replaces the old rather than layering several. Exactly
// one of choreId/choreZoneId is set (see the CHECK constraint), mirroring the same
// zoned/zoneless split as chores.status vs. chore_zones.status: a schedule attaches
// to the chore itself when it has no zones, or to one specific zone-link when it does
// (see choreService.deriveChoreStatus).
export const choreSchedules = sqliteTable(
  'chore_schedules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    choreId: integer('chore_id').references(() => chores.id, { onDelete: 'cascade' }),
    choreZoneId: integer('chore_zone_id').references(() => choreZones.id, { onDelete: 'cascade' }),
    recurrenceType: text('recurrence_type', { enum: RECURRENCE_TYPES }).notNull(),
    // Epoch ms. The schedule's anchor instant: for 'once' it's simply when it fires;
    // for a recurring type it's the first occurrence, and the source of truth for the
    // time-of-day (and, for 'weekly', which week counts as "week zero" — see
    // scheduleTime.ts) every later occurrence reuses.
    startAt: integer('start_at').notNull(),
    intervalDays: integer('interval_days'),
    intervalWeeks: integer('interval_weeks'),
    // JSON-encoded array of 0 (Sunday)-6 (Saturday). Stored as text rather than a
    // child table since it's small, read-mostly, and never queried by individual day.
    weekdays: text('weekdays'),
    intervalMonths: integer('interval_months'),
    // Derived once from startAt's local day-of-month at creation, not re-derived from
    // the previous occurrence — so "the 31st of every month" keeps aiming for the 31st
    // even after a shorter month clamps one occurrence down (see scheduleTime.ts's
    // monthly step).
    dayOfMonth: integer('day_of_month'),
    // Epoch ms, indexed: the next time choreScheduler.ts should act on this schedule.
    // Null means done — a fired 'once' schedule.
    nextRunAt: integer('next_run_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('chore_schedules_chore_id_unique')
      .on(table.choreId)
      .where(sql`${table.choreId} IS NOT NULL`),
    uniqueIndex('chore_schedules_chore_zone_id_unique')
      .on(table.choreZoneId)
      .where(sql`${table.choreZoneId} IS NOT NULL`),
    index('chore_schedules_next_run_at_idx').on(table.nextRunAt),
    check(
      'chore_schedules_exactly_one_target',
      sql`(${table.choreId} IS NULL) != (${table.choreZoneId} IS NULL)`,
    ),
  ],
);

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
  // IANA zone (e.g. "America/New_York"), captured client-side at subscribe time —
  // drives the daily reminder's "9am in the user's timezone" check
  // (dailyReminderScheduler.ts). Null for subscriptions created before that feature
  // existed; such subscriptions are simply skipped until the client resyncs (see
  // NotificationOptIn.tsx, which does this silently on every load).
  timezone: text('timezone'),
  // The last time this subscription was checked for the daily reminder, used to
  // ensure at most one check per local calendar day — not "last time a reminder was
  // actually sent," since a day with zero outstanding chores must still count as
  // checked, or the next run would just check (and likely skip) it again.
  lastDailyReminderAt: integer('last_daily_reminder_at'),
  createdAt: integer('created_at').notNull(),
});
