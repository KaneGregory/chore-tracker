# Scheduling Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Head of Household attach a one-off or recurring schedule to a chore (or one of its zone-links) that automatically flips it back to `to-do`, without any human clicking a button.

**Architecture:** A new `chore_schedules` table (one row per schedule, targeting either a zoneless chore or one `chore_zones` link) is evaluated by a polling scheduler (`choreScheduler.ts`, modeled directly on the existing `dailyReminderScheduler.ts`) that reuses a new pure date-math module (`scheduleTime.ts`) to compute occurrences in the household's own timezone. Schedules are surfaced through new endpoints on the existing chores router and a new household-timezone endpoint, and are *not* folded into the existing chore/zone read payload — they're a separate, additively-fetched concern so `choreService.ts`'s existing status/zone/assignment logic and its tests stay untouched.

**Tech Stack:** Node.js + TypeScript + Express + Drizzle ORM (SQLite) on the backend; React + TypeScript on the frontend. No new dependencies — timezone conversion is hand-rolled with `Intl.DateTimeFormat`, following the pattern `dailyReminderScheduler.ts` already established, rather than adding a date library.

## Global Constraints

- Backend: run `npm run typecheck`, `npm run lint`, and `npm test` in `backend/` before considering any task done, per `CLAUDE.md`.
- Frontend: run `npm run typecheck` and `npm run lint` in `frontend/` (no frontend test suite exists in this project yet — don't add one as part of this plan).
- Never run `npm run dev` yourself; use `npm run dev:ai` for any manual verification, and stop it by port per `CLAUDE.md`.
- No comments except why-comments (non-obvious reasoning), matching the rest of the codebase.
- No new npm dependencies.
- Head of Household only for creating/editing/removing a schedule — same authorization split as creating a chore.
- Deviation from the earlier design spec (`docs/superpowers/specs/2026-08-13-scheduling-design.md`), decided during planning: schedules are exposed via a **separate** endpoint rather than attached to the existing chore/zone read payload. Attaching them would require threading a new field through `choreService.ts`'s `ChoreSummary`/`ChoreZoneStatus` types and `attachDetails`, and rewriting roughly a dozen existing `toEqual` assertions in `routes/chores.test.ts` that currently assert exact object shapes — for zero behavioral difference to the user. A separate `GET .../chores/schedules` list, fetched once alongside chores/zones/members, gives the same UI capability with a much smaller, better-isolated diff.

---

## Task 1: Schema and migration — `chore_schedules` table + `households.timezone`

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/drizzle/00XX_<generated-name>.sql` (via `db:generate`)
- Test: `backend/src/db/migrations.test.ts` (existing — verify it still passes; no new assertions needed, it uses `arrayContaining`)

**Interfaces:**
- Produces: `choreSchedules` table export, `RECURRENCE_TYPES` / `RecurrenceType` from `backend/src/db/schema.ts`, and `households.timezone` — every later task's DB access depends on these.

- [ ] **Step 1: Add the `timezone` column to `households`**

In `backend/src/db/schema.ts`, add to the `households` table definition (right after `createdAt`):

```typescript
  // IANA zone (e.g. "America/New_York"), captured client-side the same way
  // push_subscriptions.timezone is — every chore_schedules row belonging to this
  // household is evaluated against it (see choreScheduler.ts). Null until a member's
  // browser has synced one; schedules fall back to UTC until then.
  timezone: text('timezone'),
```

- [ ] **Step 2: Add the `chore_schedules` table**

In `backend/src/db/schema.ts`, update the import line at the top to:

```typescript
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
```

Then add, after the `choreAssignments` table definition:

```typescript
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
```

- [ ] **Step 3: Generate the migration**

Run: `cd backend && npm run db:generate`

This creates a new `backend/drizzle/00XX_<random-name>.sql` and a matching `backend/drizzle/meta/00XX_snapshot.json`. Open the generated `.sql` file and confirm it contains:
- `CREATE TABLE \`chore_schedules\` (...)` including a `CHECK` clause for the exactly-one-target constraint
- `CREATE UNIQUE INDEX` statements for both partial unique indexes, each with a `WHERE ... IS NOT NULL` clause
- `ALTER TABLE \`households\` ADD \`timezone\` text;`

If drizzle-kit didn't emit the `CHECK` clause or the partial `WHERE` on either unique index (older drizzle-kit versions have had gaps here), hand-edit the generated `.sql` file to add them — same precedent as migration `0005`'s hand-edit for the username backfill (see `CLAUDE.md`).

- [ ] **Step 4: Verify against a scratch copy of the real database**

Run:
```bash
cp backend/data/chore-tracker.db /tmp/chore-tracker-scratch.db 2>/dev/null || echo "no existing db — skipping scratch-copy check"
DB_FILE=/tmp/chore-tracker-scratch.db npx tsx -e "import('./src/db/client.js').then(m => m.runMigrations())"
```
(run from `backend/`). This exercises the real `runMigrations()` (not the `sqlite3` CLI) against real data, per `CLAUDE.md`'s migration-verification note. Expected: no error. This migration doesn't recreate any existing table (it only adds a column and a new table), so it should not hit the FK-pragma issue migration `0009` had — this step is a sanity check, not expected to find anything.

- [ ] **Step 5: Run the existing migration test**

Run: `cd backend && npx vitest run src/db/migrations.test.ts`
Expected: PASS (it uses `expect.arrayContaining`, so the new table doesn't break its "creates all four application tables" assertion).

- [ ] **Step 6: Typecheck and commit**

Run: `cd backend && npm run typecheck`
Expected: PASS.

```bash
git add backend/src/db/schema.ts backend/drizzle/
git commit -m "feat: add chore_schedules table and households.timezone column"
```

---

## Task 2: `scheduleTime.ts` — pure recurrence/timezone math

**Files:**
- Create: `backend/src/services/scheduleTime.ts`
- Test: `backend/src/services/scheduleTime.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no DB).
- Produces: `RecurrenceType` (re-exported from `../db/schema.js`), `ScheduleRecurrence` interface, `toLocalDateTime`, `fromLocalDateTime`, `weekdayOf`, `computeInitialNextRunAt`, `advanceUntilFuture` — `scheduleService.ts` (Task 6) and `choreScheduler.ts` (Task 8) both import from here.

This is the trickiest part of the feature: converting between an instant and local wall-clock components in an arbitrary IANA zone (no date library — see Global Constraints), and correctly advancing each of the four recurrence types. Write it test-first, one function at a time.

- [ ] **Step 1: Write failing tests for `toLocalDateTime` / `weekdayOf`**

Create `backend/src/services/scheduleTime.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { toLocalDateTime, weekdayOf } from './scheduleTime.js';

describe('toLocalDateTime', () => {
  it('reads UTC components directly', () => {
    const instant = Date.UTC(2026, 0, 7, 9, 30); // Wed 2026-01-07 09:30 UTC
    expect(toLocalDateTime(instant, 'UTC')).toEqual({
      year: 2026,
      month: 1,
      day: 7,
      hour: 9,
      minute: 30,
    });
  });

  it('converts to a non-UTC zone', () => {
    // 09:30 UTC is 04:30 EST (America/New_York, UTC-5, no DST in January).
    const instant = Date.UTC(2026, 0, 7, 9, 30);
    expect(toLocalDateTime(instant, 'America/New_York')).toEqual({
      year: 2026,
      month: 1,
      day: 7,
      hour: 4,
      minute: 30,
    });
  });
});

describe('weekdayOf', () => {
  it('identifies a known Wednesday as weekday 3', () => {
    expect(weekdayOf(2026, 1, 7)).toBe(3);
  });

  it('identifies a known Sunday as weekday 0', () => {
    expect(weekdayOf(2026, 1, 11)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/services/scheduleTime.test.ts`
Expected: FAIL — `scheduleTime.ts` doesn't exist yet.

- [ ] **Step 3: Implement `toLocalDateTime` and `weekdayOf`**

Create `backend/src/services/scheduleTime.ts`:

```typescript
export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

function formatPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

// Converts an instant to its wall-clock components in the given IANA zone. Same
// technique as dailyReminderScheduler.ts's localDateAndHour, extended with minutes.
export function toLocalDateTime(instantMs: number, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));

  return {
    year: Number(formatPart(parts, 'year')),
    month: Number(formatPart(parts, 'month')),
    day: Number(formatPart(parts, 'day')),
    hour: Number(formatPart(parts, 'hour')),
    minute: Number(formatPart(parts, 'minute')),
  };
}

// Weekday of a calendar date (0 = Sunday .. 6 = Saturday). Computed via a UTC-midnight
// Date rather than any real-zone instant — a calendar date's weekday never depends on
// what time of day or zone you ask from.
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run src/services/scheduleTime.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for `fromLocalDateTime`**

Add to `backend/src/services/scheduleTime.test.ts`:

```typescript
import { fromLocalDateTime } from './scheduleTime.js';

describe('fromLocalDateTime', () => {
  it('round-trips through UTC', () => {
    const instant = fromLocalDateTime({ year: 2026, month: 1, day: 7, hour: 9, minute: 30 }, 'UTC');
    expect(instant).toBe(Date.UTC(2026, 0, 7, 9, 30));
  });

  it('resolves a non-UTC zone to the correct UTC instant', () => {
    // 09:00 in America/New_York (EST, UTC-5) in January is 14:00 UTC.
    const instant = fromLocalDateTime(
      { year: 2026, month: 1, day: 7, hour: 9, minute: 0 },
      'America/New_York',
    );
    expect(instant).toBe(Date.UTC(2026, 0, 7, 14, 0));
  });

  it('accounts for a DST offset difference between January and July', () => {
    // 09:00 in America/New_York in July (EDT, UTC-4) is 13:00 UTC — one hour earlier
    // in UTC terms than the January case above, despite the same local wall-clock time.
    const instant = fromLocalDateTime(
      { year: 2026, month: 7, day: 7, hour: 9, minute: 0 },
      'America/New_York',
    );
    expect(instant).toBe(Date.UTC(2026, 6, 7, 13, 0));
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd backend && npx vitest run src/services/scheduleTime.test.ts`
Expected: FAIL — `fromLocalDateTime` is not exported yet.

- [ ] **Step 7: Implement `fromLocalDateTime`**

Add to `backend/src/services/scheduleTime.ts`:

```typescript
// The offset (ms) `timeZone` is at around `instantMs` — local time minus UTC time, at
// that moment.
function offsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));

  const asIfUtc = Date.UTC(
    Number(formatPart(parts, 'year')),
    Number(formatPart(parts, 'month')) - 1,
    Number(formatPart(parts, 'day')),
    Number(formatPart(parts, 'hour')),
    Number(formatPart(parts, 'minute')),
    Number(formatPart(parts, 'second')),
  );
  return asIfUtc - instantMs;
}

// Inverse of toLocalDateTime: the instant at which `timeZone` reads these wall-clock
// components. Resolves the zone's offset from a same-instant guess rather than a true
// two-pass search — accurate for any time outside the handful of ambiguous seconds
// right at a DST transition itself, which a fixed schedule hour essentially never
// lands on.
export function fromLocalDateTime(local: LocalDateTime, timeZone: string): number {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return guess - offsetMs(guess, timeZone);
}
```

- [ ] **Step 8: Run to verify pass**

Run: `cd backend && npx vitest run src/services/scheduleTime.test.ts`
Expected: PASS.

- [ ] **Step 9: Write failing tests for `computeInitialNextRunAt` and `advanceUntilFuture` — `once` and `every_n_days`**

Add to `backend/src/services/scheduleTime.test.ts`:

```typescript
import { advanceUntilFuture, computeInitialNextRunAt } from './scheduleTime.js';
import type { ScheduleRecurrence } from './scheduleTime.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('computeInitialNextRunAt', () => {
  it('returns startAt directly for a future one-off', () => {
    const startAt = Date.UTC(2026, 0, 10, 9, 0);
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'once',
      startAt,
      intervalDays: null,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
    };
    expect(computeInitialNextRunAt(schedule, 'UTC', Date.UTC(2026, 0, 1))).toBe(startAt);
  });

  it('returns null for a one-off already in the past', () => {
    const startAt = Date.UTC(2026, 0, 1, 9, 0);
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'once',
      startAt,
      intervalDays: null,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
    };
    expect(computeInitialNextRunAt(schedule, 'UTC', Date.UTC(2026, 0, 10))).toBeNull();
  });

  it('returns startAt for a future every_n_days schedule', () => {
    const startAt = Date.UTC(2026, 0, 10, 9, 0);
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'every_n_days',
      startAt,
      intervalDays: 3,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
    };
    expect(computeInitialNextRunAt(schedule, 'UTC', Date.UTC(2026, 0, 1))).toBe(startAt);
  });

  it('fast-forwards a past every_n_days start to the next future occurrence', () => {
    const startAt = Date.UTC(2026, 0, 1, 9, 0);
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'every_n_days',
      startAt,
      intervalDays: 3,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
    };
    // now = Jan 8, 10am — occurrences are Jan1, 4, 7, 10... next strictly-future one is Jan10.
    const now = Date.UTC(2026, 0, 8, 10, 0);
    expect(computeInitialNextRunAt(schedule, 'UTC', now)).toBe(Date.UTC(2026, 0, 10, 9, 0));
  });
});

describe('advanceUntilFuture — every_n_days', () => {
  it('steps forward by intervalDays, one occurrence past a single-cycle now', () => {
    const startAt = Date.UTC(2026, 0, 1, 9, 0);
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'every_n_days',
      startAt,
      intervalDays: 3,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
    };
    const firedAt = Date.UTC(2026, 0, 4, 9, 0);
    const next = advanceUntilFuture(schedule, 'UTC', firedAt, firedAt);
    expect(next).toBe(Date.UTC(2026, 0, 7, 9, 0));
  });

  it('catches up multiple missed cycles in one call', () => {
    const startAt = Date.UTC(2026, 0, 1, 9, 0);
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'every_n_days',
      startAt,
      intervalDays: 1,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
    };
    const now = startAt + 10 * DAY_MS + 1000; // well past 10 missed daily cycles
    const next = advanceUntilFuture(schedule, 'UTC', now, startAt);
    expect(next).toBe(startAt + 11 * DAY_MS);
  });
});
```

- [ ] **Step 10: Run to verify failure**

Run: `cd backend && npx vitest run src/services/scheduleTime.test.ts`
Expected: FAIL — neither function is exported yet.

- [ ] **Step 11: Implement `ScheduleRecurrence`, `stepOnce` (once/every_n_days only for now), `advanceUntilFuture`, `computeInitialNextRunAt`**

Add to `backend/src/services/scheduleTime.ts`:

```typescript
import type { RecurrenceType } from '../db/schema.js';
export type { RecurrenceType };

export interface ScheduleRecurrence {
  recurrenceType: RecurrenceType;
  startAt: number; // epoch ms — the anchor instant (see chore_schedules.startAt's comment)
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null;
  intervalMonths: number | null;
  dayOfMonth: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnlyUtcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

function instantAt(dateUtcMs: number, hour: number, minute: number, timeZone: string): number {
  const d = new Date(dateUtcMs);
  return fromLocalDateTime(
    { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute },
    timeZone,
  );
}

// One cadence step forward from `fromInstantMs`. Always reconstructs using the
// schedule's own anchor (startAt) hour/minute, never `fromInstantMs`'s — the
// time-of-day is fixed at creation and must never drift.
function stepOnce(schedule: ScheduleRecurrence, timeZone: string, fromInstantMs: number): number {
  const anchor = toLocalDateTime(schedule.startAt, timeZone);
  const from = toLocalDateTime(fromInstantMs, timeZone);

  switch (schedule.recurrenceType) {
    case 'every_n_days': {
      const nextDateMs = dateOnlyUtcMs(from.year, from.month, from.day) + schedule.intervalDays! * DAY_MS;
      return instantAt(nextDateMs, anchor.hour, anchor.minute, timeZone);
    }
    case 'weekly':
      return nextWeeklyOccurrence(schedule, timeZone, fromInstantMs, 1);
    case 'monthly': {
      const targetMonthIndex = from.year * 12 + (from.month - 1) + schedule.intervalMonths!;
      const targetYear = Math.floor(targetMonthIndex / 12);
      const targetMonth0 = targetMonthIndex % 12;
      const lastDay = new Date(Date.UTC(targetYear, targetMonth0 + 1, 0)).getUTCDate();
      const day = Math.min(schedule.dayOfMonth!, lastDay);
      return instantAt(Date.UTC(targetYear, targetMonth0, day), anchor.hour, anchor.minute, timeZone);
    }
    case 'once':
      throw new Error('A one-off schedule has no next occurrence');
  }
}

// The next weekday-matching occurrence, searching from `searchFromInstantMs`'s local
// date. `offsetStart` is 0 to include that date itself in the search (used when
// finding the very first occurrence) or 1 to search strictly after it (used when
// stepping past an occurrence that already happened). The week-cadence ("every N
// weeks") is always measured relative to the schedule's own anchor date, never the
// search start — see scheduleTime's design notes for why: measuring from the previous
// occurrence instead breaks as soon as more than one weekday is selected.
function nextWeeklyOccurrence(
  schedule: ScheduleRecurrence,
  timeZone: string,
  searchFromInstantMs: number,
  offsetStart: 0 | 1,
): number {
  const anchor = toLocalDateTime(schedule.startAt, timeZone);
  const searchFrom = toLocalDateTime(searchFromInstantMs, timeZone);
  const anchorDateMs = dateOnlyUtcMs(anchor.year, anchor.month, anchor.day);
  const searchFromDateMs = dateOnlyUtcMs(searchFrom.year, searchFrom.month, searchFrom.day);
  const weekdays = new Set(schedule.weekdays!);
  const intervalWeeks = schedule.intervalWeeks!;

  // Bounded: within one full cadence cycle there must be a qualifying day, since
  // weekdays is non-empty and the cycle repeats every intervalWeeks weeks.
  for (let offset = offsetStart; offset < offsetStart + intervalWeeks * 7; offset++) {
    const candidateDateMs = searchFromDateMs + offset * DAY_MS;
    const daysSinceAnchor = Math.round((candidateDateMs - anchorDateMs) / DAY_MS);
    const weekIndex = Math.floor(daysSinceAnchor / 7);
    if (weekIndex % intervalWeeks !== 0) continue;
    const candidate = new Date(candidateDateMs);
    const weekday = weekdayOf(
      candidate.getUTCFullYear(),
      candidate.getUTCMonth() + 1,
      candidate.getUTCDate(),
    );
    if (!weekdays.has(weekday)) continue;
    return instantAt(candidateDateMs, anchor.hour, anchor.minute, timeZone);
  }
  throw new Error('No qualifying weekday found within one cadence cycle');
}

// The very first occurrence at/after the schedule's own anchor date — for
// every_n_days/monthly that's always startAt itself (the user's chosen start date IS
// the pattern's day 1); for weekly it may snap forward, since the user's weekdays
// selection need not include the start date's own weekday.
function firstOccurrenceOnOrAfterAnchor(schedule: ScheduleRecurrence, timeZone: string): number {
  if (schedule.recurrenceType === 'weekly') {
    return nextWeeklyOccurrence(schedule, timeZone, schedule.startAt, 0);
  }
  return schedule.startAt;
}

// Advances from `fromInstantMs` (defaulting to the schedule's own anchor) to the next
// occurrence strictly after `now` — looping rather than a single step so a schedule
// that missed several cycles (e.g. the server was down) catches up within one poll
// pass rather than one poll tick per missed cycle.
export function advanceUntilFuture(
  schedule: ScheduleRecurrence,
  timeZone: string,
  now: number,
  fromInstantMs: number = schedule.startAt,
): number {
  let next = stepOnce(schedule, timeZone, fromInstantMs);
  while (next <= now) {
    next = stepOnce(schedule, timeZone, next);
  }
  return next;
}

// The schedule's very first nextRunAt, computed once when it's created (or replaced).
// A one-off already in the past never fires again (null). A recurring schedule whose
// first occurrence is still in the future fires exactly then; one whose first
// occurrence has already passed fast-forwards to the next future occurrence.
export function computeInitialNextRunAt(
  schedule: ScheduleRecurrence,
  timeZone: string,
  now: number,
): number | null {
  if (schedule.recurrenceType === 'once') {
    return schedule.startAt > now ? schedule.startAt : null;
  }
  const firstOccurrence = firstOccurrenceOnOrAfterAnchor(schedule, timeZone);
  return firstOccurrence > now ? firstOccurrence : advanceUntilFuture(schedule, timeZone, now, firstOccurrence);
}
```

- [ ] **Step 12: Run to verify pass**

Run: `cd backend && npx vitest run src/services/scheduleTime.test.ts`
Expected: PASS.

- [ ] **Step 13: Write failing tests for weekly recurrence, including the multi-weekday + multi-week case**

Add to `backend/src/services/scheduleTime.test.ts`:

```typescript
describe('weekly recurrence', () => {
  // 2026-01-07 is a Wednesday, which is deliberately NOT one of the selected weekdays
  // below, to exercise the "snap forward to the first qualifying day" behavior.
  const startAt = Date.UTC(2026, 0, 7, 9, 0);
  const MONDAY = 1;
  const THURSDAY = 4;

  it('snaps the first occurrence forward to the first qualifying weekday', () => {
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'weekly',
      startAt,
      intervalDays: null,
      intervalWeeks: 2,
      weekdays: [MONDAY, THURSDAY],
      intervalMonths: null,
      dayOfMonth: null,
    };
    // Jan 7 is Wed; the first qualifying day on/after it is Thu Jan 8.
    expect(computeInitialNextRunAt(schedule, 'UTC', Date.UTC(2026, 0, 1))).toBe(
      Date.UTC(2026, 0, 8, 9, 0),
    );
  });

  it('fires on every selected weekday within a qualifying week, then skips the off week', () => {
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'weekly',
      startAt,
      intervalDays: null,
      intervalWeeks: 2,
      weekdays: [MONDAY, THURSDAY],
      intervalMonths: null,
      dayOfMonth: null,
    };
    // Week 0 (containing Jan 7): Thu Jan 8, then Mon Jan 12.
    // Week 1 (Jan 14-20) is skipped entirely (odd week, intervalWeeks=2).
    // Week 2 (Jan 21-27): Thu Jan 22, then Mon Jan 26.
    const afterJan8 = advanceUntilFuture(schedule, 'UTC', Date.UTC(2026, 0, 8, 9, 0), Date.UTC(2026, 0, 8, 9, 0));
    expect(afterJan8).toBe(Date.UTC(2026, 0, 12, 9, 0));

    const afterJan12 = advanceUntilFuture(
      schedule,
      'UTC',
      Date.UTC(2026, 0, 12, 9, 0),
      Date.UTC(2026, 0, 12, 9, 0),
    );
    expect(afterJan12).toBe(Date.UTC(2026, 0, 22, 9, 0));

    const afterJan22 = advanceUntilFuture(
      schedule,
      'UTC',
      Date.UTC(2026, 0, 22, 9, 0),
      Date.UTC(2026, 0, 22, 9, 0),
    );
    expect(afterJan22).toBe(Date.UTC(2026, 0, 26, 9, 0));
  });

  it('fires every week when intervalWeeks is 1', () => {
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'weekly',
      startAt,
      intervalDays: null,
      intervalWeeks: 1,
      weekdays: [MONDAY],
      intervalMonths: null,
      dayOfMonth: null,
    };
    const first = computeInitialNextRunAt(schedule, 'UTC', Date.UTC(2026, 0, 1));
    expect(first).toBe(Date.UTC(2026, 0, 12, 9, 0)); // first Monday on/after Jan 7
    const next = advanceUntilFuture(schedule, 'UTC', first!, first!);
    expect(next).toBe(Date.UTC(2026, 0, 19, 9, 0)); // the following Monday
  });
});

describe('monthly recurrence', () => {
  it('advances by intervalMonths, keeping the same day of month', () => {
    const startAt = Date.UTC(2026, 0, 15, 9, 0); // Jan 15
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'monthly',
      startAt,
      intervalDays: null,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: 1,
      dayOfMonth: 15,
    };
    const next = advanceUntilFuture(schedule, 'UTC', startAt, startAt);
    expect(next).toBe(Date.UTC(2026, 1, 15, 9, 0)); // Feb 15
  });

  it('clamps to the last day of a shorter month, then recovers the original day when possible', () => {
    const startAt = Date.UTC(2026, 0, 31, 9, 0); // Jan 31
    const schedule: ScheduleRecurrence = {
      recurrenceType: 'monthly',
      startAt,
      intervalDays: null,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: 1,
      dayOfMonth: 31,
    };
    const feb = advanceUntilFuture(schedule, 'UTC', startAt, startAt);
    expect(feb).toBe(Date.UTC(2026, 1, 28, 9, 0)); // 2026 is not a leap year
    const mar = advanceUntilFuture(schedule, 'UTC', feb, feb);
    expect(mar).toBe(Date.UTC(2026, 2, 31, 9, 0)); // back to the 31st in March
  });
});
```

- [ ] **Step 14: Run to verify pass**

Run: `cd backend && npx vitest run src/services/scheduleTime.test.ts`
Expected: PASS — `stepOnce`'s `weekly`/`monthly` branches and `nextWeeklyOccurrence` were already implemented in Step 11.

- [ ] **Step 15: Full test run, typecheck, lint, commit**

Run: `cd backend && npx vitest run src/services/scheduleTime.test.ts && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add backend/src/services/scheduleTime.ts backend/src/services/scheduleTime.test.ts
git commit -m "feat: add pure recurrence/timezone math for chore scheduling"
```

---

## Task 3: Household timezone — shared validator, schema, service, route

**Files:**
- Create: `backend/src/validation/timeZoneSchema.ts`
- Modify: `backend/src/validation/pushSchemas.ts` (use the shared schema instead of its own copy)
- Modify: `backend/src/validation/householdSchemas.ts`
- Modify: `backend/src/errors.ts`
- Modify: `backend/src/services/householdService.ts`
- Modify: `backend/src/routes/households.ts`
- Test: `backend/src/routes/households.test.ts`

**Interfaces:**
- Produces: `timeZoneSchema` (validation), `householdService.setTimezone(householdId, requestingUserId, timezone): void` — Task 6's `scheduleService.ts` reads `households.timezone` directly via Drizzle, not through this function (this function is only for the mutation endpoint).

- [ ] **Step 1: Extract the shared IANA timezone validator**

Create `backend/src/validation/timeZoneSchema.ts`:

```typescript
import { z } from 'zod';

function isValidIanaTimeZone(value: string): boolean {
  try {
    // Throws RangeError for anything that isn't a real IANA zone name — the standard
    // way to validate one without hardcoding/maintaining a zone list.
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().min(1).refine(isValidIanaTimeZone, 'Invalid time zone');
```

In `backend/src/validation/pushSchemas.ts`, remove the now-duplicated `isValidIanaTimeZone` function and its local `timeZoneSchema` const, and instead add near the top:

```typescript
import { timeZoneSchema } from './timeZoneSchema.js';
```

(Everything else in `pushSchemas.ts` stays the same — `pushSubscriptionSchema` already references `timeZoneSchema` by that name.)

- [ ] **Step 2: Add the timezone mutation schema**

In `backend/src/validation/householdSchemas.ts`, add:

```typescript
import { timeZoneSchema } from './timeZoneSchema.js';

export const setHouseholdTimezoneSchema = z.object({
  timezone: timeZoneSchema,
});
```

- [ ] **Step 3: Write a failing route test**

Add to `backend/src/routes/households.test.ts` (find the existing `describe` blocks and add a new one near the end of the file, following the same `registerHeadOfHousehold`/`registerAndJoin` helpers already defined there):

```typescript
describe('PATCH /api/households/:householdId/timezone', () => {
  it('lets any active member set the household timezone', async () => {
    const head = await registerHeadOfHousehold('tz-hoh@example.com', 'Timezone House');
    const member = await registerAndJoin('tz-member@example.com', head);

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/timezone`)
      .set('Cookie', member.cookie)
      .send({ timezone: 'America/New_York' });

    expect(response.status).toBe(204);
  });

  it('rejects an invalid timezone name', async () => {
    const head = await registerHeadOfHousehold('tz-invalid-hoh@example.com', 'Invalid TZ House');

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/timezone`)
      .set('Cookie', head.cookie)
      .send({ timezone: 'Not/AZone' });

    expect(response.status).toBe(400);
  });

  it('rejects a non-member with a generic 404', async () => {
    const head = await registerHeadOfHousehold('tz-outsider-hoh@example.com', 'Outsider TZ House');
    const outsider = await registerHeadOfHousehold('tz-outsider@example.com', 'Outsider TZ House 2');

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/timezone`)
      .set('Cookie', outsider.cookie)
      .send({ timezone: 'UTC' });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd backend && npx vitest run src/routes/households.test.ts`
Expected: FAIL — the route doesn't exist yet (404 for all three, so the first two assertions fail).

- [ ] **Step 5: Implement `householdService.setTimezone`**

Add to `backend/src/services/householdService.ts`:

```typescript
export function setTimezone(householdId: number, requestingUserId: number, timezone: string): void {
  requireMembership(householdId, requestingUserId);
  db.update(households).set({ timezone }).where(eq(households.id, householdId)).run();
}
```

(`households` is already imported at the top of this file.)

- [ ] **Step 6: Wire the route**

In `backend/src/routes/households.ts`, add to the imports:

```typescript
import { setHouseholdTimezoneSchema } from '../validation/householdSchemas.js';
```

(add `setHouseholdTimezoneSchema` into the existing destructured import from `'../validation/householdSchemas.js'`), then add a new route (placed after the `POST /` route, before the members routes):

```typescript
householdsRouter.patch('/:householdId/timezone', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = householdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = setHouseholdTimezoneSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid timezone', bodyParsed.error.issues));
    return;
  }

  try {
    householdService.setTimezone(paramsParsed.data.householdId, req.user.id, bodyParsed.data.timezone);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 7: Run to verify pass**

Run: `cd backend && npx vitest run src/routes/households.test.ts`
Expected: PASS.

- [ ] **Step 8: Full backend test run, typecheck, lint (confirms the pushSchemas.ts refactor didn't break anything), commit**

Run: `cd backend && npm test && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add backend/src/validation/timeZoneSchema.ts backend/src/validation/pushSchemas.ts backend/src/validation/householdSchemas.ts backend/src/services/householdService.ts backend/src/routes/households.ts backend/src/routes/households.test.ts
git commit -m "feat: let a household's own timezone be synced from the client"
```

---

## Task 4: `scheduleSchemas.ts` — validation for the schedule request body

**Files:**
- Create: `backend/src/validation/scheduleSchemas.ts`

**Interfaces:**
- Produces: `setScheduleSchema`, `SetScheduleInput` — consumed by Task 6 (`scheduleService.ts`) and Task 7 (routes).

No dedicated test file for this task — it's exercised through Task 7's route tests, same as `choreSchemas.ts` has no test file of its own.

- [ ] **Step 1: Write the schema**

Create `backend/src/validation/scheduleSchemas.ts`:

```typescript
import { z } from 'zod';

// Local wall-clock date/time, interpreted against the household's own timezone
// server-side (see scheduleService.ts) — not the browser's timezone, since a
// schedule belongs to the household, not to whoever happens to be setting it.
const startDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const startTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
const weekdaySchema = z.number().int().min(0).max(6);

const onceScheduleSchema = z.object({
  recurrenceType: z.literal('once'),
  startDate: startDateSchema,
  startTime: startTimeSchema,
});

const everyNDaysScheduleSchema = z.object({
  recurrenceType: z.literal('every_n_days'),
  startDate: startDateSchema,
  startTime: startTimeSchema,
  intervalDays: z.number().int().min(1).max(365),
});

const weeklyScheduleSchema = z.object({
  recurrenceType: z.literal('weekly'),
  startDate: startDateSchema,
  startTime: startTimeSchema,
  intervalWeeks: z.number().int().min(1).max(52),
  weekdays: z.array(weekdaySchema).min(1).max(7),
});

// dayOfMonth is deliberately not a client-supplied field — it's derived from
// startDate server-side (see scheduleService.ts), so the two can never disagree.
const monthlyScheduleSchema = z.object({
  recurrenceType: z.literal('monthly'),
  startDate: startDateSchema,
  startTime: startTimeSchema,
  intervalMonths: z.number().int().min(1).max(24),
});

export const setScheduleSchema = z.discriminatedUnion('recurrenceType', [
  onceScheduleSchema,
  everyNDaysScheduleSchema,
  weeklyScheduleSchema,
  monthlyScheduleSchema,
]);

export type SetScheduleInput = z.infer<typeof setScheduleSchema>;
```

- [ ] **Step 2: Typecheck and commit**

Run: `cd backend && npm run typecheck`
Expected: PASS.

```bash
git add backend/src/validation/scheduleSchemas.ts
git commit -m "feat: add request validation for chore schedules"
```

---

## Task 5: `choreService.ts` — nullable `requestingUserId`, system-triggered reopen

**Files:**
- Modify: `backend/src/services/choreService.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `systemReopenChore(choreId: number): boolean`, `systemReopenChoreZone(choreId: number, zoneId: number): boolean` — Task 8's `choreScheduler.ts` calls these. `notifyAssignees`'s signature changes but stays internal (not exported).

No new test file — `systemReopenChore`/`systemReopenChoreZone` are exercised through Task 8's `choreScheduler.test.ts`, the same way today's `userHasIncompleteAssignedChores` (also an internal, route-free system function in this file) is only exercised through `dailyReminderScheduler.test.ts`.

- [ ] **Step 1: Widen `notifyAssignees`'s `requestingUserId` to allow `null`**

In `backend/src/services/choreService.ts`, change the `notifyAssignees` signature and body:

```typescript
function notifyAssignees(
  choreId: number,
  zoneId: number | null,
  choreName: string,
  requestingUserId: number | null,
  queueFn: QueueNotificationFn,
): void {
  const assignments = db
    .select({ userId: choreAssignments.userId })
    .from(choreAssignments)
    .where(
      zoneId === null
        ? eq(choreAssignments.choreId, choreId)
        : and(
            eq(choreAssignments.choreId, choreId),
            or(isNull(choreAssignments.zoneId), eq(choreAssignments.zoneId, zoneId)),
          ),
    )
    .all();

  const userIds = new Set(assignments.map((row) => row.userId));
  // null means a system-triggered change (see systemReopenChore/systemReopenChoreZone)
  // — there's no acting human to exclude, so every assignee gets notified.
  if (requestingUserId !== null) userIds.delete(requestingUserId);
  for (const userId of userIds) {
    queueFn(userId, choreId, zoneId, choreName);
  }
}
```

Also update the docstring comment directly above `notifyAssignees` (currently ends with "Never queues for requestingUserId...") to:

```typescript
// Assignees to notify on a chore/zone status change: anyone assigned directly to
// that zone, plus anyone assigned to the whole chore (zoneId IS NULL applies across
// all of its zones) — same "whole chore vs. one zone" split the schema documents for
// choreAssignments.zoneId. Never queues for requestingUserId (when there is one) — a
// user is never notified about a change they made themselves.
```

- [ ] **Step 2: Run existing tests to confirm nothing broke**

Run: `cd backend && npx vitest run src/routes/chores.test.ts src/routes/notificationIntegration.test.ts`
Expected: PASS — `number` is still assignable wherever `number | null` is expected, so every existing call site (`setChoreStatus`/`setChoreZoneStatus`, both still passing a real `requestingUserId`) is unaffected.

- [ ] **Step 3: Add `systemReopenChore` and `systemReopenChoreZone`**

Add to `backend/src/services/choreService.ts`, after `setChoreZoneStatus`:

```typescript
// Internal system mutation for choreScheduler.ts — flips a zoneless chore's status
// from 'complete' back to 'to-do' when its schedule fires, skipping the
// requireMembership/role checks every user-facing status change goes through, since
// there's no requesting user, only "this schedule says it's time." No-ops (returns
// false) if the chore isn't currently 'complete' — an 'overdue' chore is deliberately
// left alone so a missed cycle stays visible rather than being silently cleared, and
// an already-'to-do' chore has nothing to do.
export function systemReopenChore(choreId: number): boolean {
  const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
  if (!chore || chore.status !== 'complete') return false;

  db.update(chores).set({ status: 'to-do' }).where(eq(chores.id, choreId)).run();
  notifyAssignees(choreId, null, chore.name, null, queueReopenedNotification);
  return true;
}

// Same as systemReopenChore, but for one zone-link of a chore.
export function systemReopenChoreZone(choreId: number, zoneId: number): boolean {
  const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
  if (!chore) return false;

  const link = db
    .select({ id: choreZones.id, status: choreZones.status })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link || link.status !== 'complete') return false;

  db.update(choreZones).set({ status: 'to-do' }).where(eq(choreZones.id, link.id)).run();
  notifyAssignees(choreId, zoneId, chore.name, null, queueReopenedNotification);
  return true;
}
```

- [ ] **Step 4: Typecheck, lint, full test run, commit**

Run: `cd backend && npm run typecheck && npm run lint && npm test`
Expected: all PASS.

```bash
git add backend/src/services/choreService.ts
git commit -m "feat: add system-triggered chore/zone reopen for scheduling"
```

---

## Task 6: `scheduleService.ts` — CRUD, authorization, and DB access

**Files:**
- Modify: `backend/src/errors.ts`
- Create: `backend/src/services/scheduleService.ts`

**Interfaces:**
- Consumes: `computeInitialNextRunAt`, `ScheduleRecurrence` from `./scheduleTime.js` (Task 2); `setScheduleSchema`'s inferred `SetScheduleInput` type from `../validation/scheduleSchemas.js` (Task 4); `requireHeadMembership`, `requireMembership` from `./membershipAuth.js`.
- Produces: `ScheduleSummary` interface, `ScheduleWithTarget` interface, `setScheduleForChore`, `removeScheduleForChore`, `setScheduleForChoreZone`, `removeScheduleForChoreZone`, `listSchedulesForHousehold` — all consumed by Task 7's routes.

No dedicated unit-test file — like `choreService.ts`, this is exercised entirely through Task 7's route-level tests (`chores.test.ts`), since every function here has an HTTP entry point.

- [ ] **Step 1: Add the new error class**

Add to `backend/src/errors.ts`, after `ChoreStatusManagedByZonesError`:

```typescript
export class ChoreScheduleManagedByZonesError extends AppError {
  constructor() {
    super(
      400,
      'ChoreScheduleManagedByZones',
      'This chore has zones — set a schedule on each zone individually',
    );
  }
}
```

- [ ] **Step 2: Write `scheduleService.ts`**

Create `backend/src/services/scheduleService.ts`:

```typescript
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { choreSchedules, choreZones, chores, households } from '../db/schema.js';
import type { RecurrenceType } from '../db/schema.js';
import { ChoreNotFoundError, ChoreScheduleManagedByZonesError, ChoreZoneMismatchError } from '../errors.js';
import { requireHeadMembership, requireMembership } from './membershipAuth.js';
import { computeInitialNextRunAt, fromLocalDateTime, toLocalDateTime } from './scheduleTime.js';
import type { ScheduleRecurrence } from './scheduleTime.js';
import type { SetScheduleInput } from '../validation/scheduleSchemas.js';

export interface ScheduleSummary {
  recurrenceType: RecurrenceType;
  startDate: string;
  startTime: string;
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null;
  intervalMonths: number | null;
  nextRunAt: number | null;
}

export interface ScheduleWithTarget extends ScheduleSummary {
  choreId: number;
  zoneId: number | null;
}

type ScheduleRow = typeof choreSchedules.$inferSelect;

function toSummary(row: ScheduleRow, timeZone: string): ScheduleSummary {
  const local = toLocalDateTime(row.startAt, timeZone);
  const startDate = `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const startTime = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
  return {
    recurrenceType: row.recurrenceType,
    startDate,
    startTime,
    intervalDays: row.intervalDays,
    intervalWeeks: row.intervalWeeks,
    weekdays: row.weekdays ? (JSON.parse(row.weekdays) as number[]) : null,
    intervalMonths: row.intervalMonths,
    nextRunAt: row.nextRunAt,
  };
}

function getHouseholdTimezone(householdId: number): string {
  const row = db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, householdId))
    .get();
  return row?.timezone ?? 'UTC';
}

function findChoreInHousehold(householdId: number, choreId: number) {
  return db
    .select({ id: chores.id })
    .from(chores)
    .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
    .get();
}

function choreHasAnyZoneLink(choreId: number): boolean {
  return (
    db.select({ id: choreZones.id }).from(choreZones).where(eq(choreZones.choreId, choreId)).get() !==
    undefined
  );
}

// Builds the recurrence-specific column values from validated input. dayOfMonth is
// derived from startDate here (not accepted from the client — see scheduleSchemas.ts)
// so it can never disagree with the date the user actually picked.
function buildRowValues(input: SetScheduleInput, startAt: number) {
  switch (input.recurrenceType) {
    case 'once':
      return {
        recurrenceType: 'once' as const,
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
      };
    case 'every_n_days':
      return {
        recurrenceType: 'every_n_days' as const,
        intervalDays: input.intervalDays,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
      };
    case 'weekly':
      return {
        recurrenceType: 'weekly' as const,
        intervalDays: null,
        intervalWeeks: input.intervalWeeks,
        weekdays: JSON.stringify([...new Set(input.weekdays)].sort((a, b) => a - b)),
        intervalMonths: null,
        dayOfMonth: null,
      };
    case 'monthly':
      return {
        recurrenceType: 'monthly' as const,
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: input.intervalMonths,
        dayOfMonth: Number(input.startDate.split('-')[2]),
      };
  }
}

function toRecurrence(startAt: number, values: ReturnType<typeof buildRowValues>): ScheduleRecurrence {
  return {
    startAt,
    recurrenceType: values.recurrenceType,
    intervalDays: values.intervalDays,
    intervalWeeks: values.intervalWeeks,
    weekdays: values.weekdays ? (JSON.parse(values.weekdays) as number[]) : null,
    intervalMonths: values.intervalMonths,
    dayOfMonth: values.dayOfMonth,
  };
}

function insertSchedule(
  target: { choreId: number; choreZoneId: null } | { choreId: null; choreZoneId: number },
  input: SetScheduleInput,
  timeZone: string,
): ScheduleSummary {
  const [year, month, day] = input.startDate.split('-').map(Number);
  const [hour, minute] = input.startTime.split(':').map(Number);
  const startAt = fromLocalDateTime({ year, month, day, hour, minute }, timeZone);

  const values = buildRowValues(input, startAt);
  const recurrence = toRecurrence(startAt, values);
  const nextRunAt = computeInitialNextRunAt(recurrence, timeZone, Date.now());

  const row = db.transaction((tx) => {
    if (target.choreId !== null) {
      tx.delete(choreSchedules).where(eq(choreSchedules.choreId, target.choreId)).run();
    } else {
      tx.delete(choreSchedules).where(eq(choreSchedules.choreZoneId, target.choreZoneId)).run();
    }
    return tx
      .insert(choreSchedules)
      .values({ ...target, startAt, ...values, nextRunAt, createdAt: Date.now() })
      .returning()
      .get();
  });

  return toSummary(row, timeZone);
}

export function setScheduleForChore(
  householdId: number,
  choreId: number,
  requestingUserId: number,
  input: SetScheduleInput,
): ScheduleSummary {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();
  if (choreHasAnyZoneLink(choreId)) throw new ChoreScheduleManagedByZonesError();

  return insertSchedule({ choreId, choreZoneId: null }, input, getHouseholdTimezone(householdId));
}

export function removeScheduleForChore(
  householdId: number,
  choreId: number,
  requestingUserId: number,
): void {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  db.delete(choreSchedules).where(eq(choreSchedules.choreId, choreId)).run();
}

export function setScheduleForChoreZone(
  householdId: number,
  choreId: number,
  zoneId: number,
  requestingUserId: number,
  input: SetScheduleInput,
): ScheduleSummary {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const link = db
    .select({ id: choreZones.id })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link) throw new ChoreZoneMismatchError();

  return insertSchedule({ choreId: null, choreZoneId: link.id }, input, getHouseholdTimezone(householdId));
}

export function removeScheduleForChoreZone(
  householdId: number,
  choreId: number,
  zoneId: number,
  requestingUserId: number,
): void {
  requireHeadMembership(householdId, requestingUserId);

  const chore = findChoreInHousehold(householdId, choreId);
  if (!chore) throw new ChoreNotFoundError();

  const link = db
    .select({ id: choreZones.id })
    .from(choreZones)
    .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
    .get();
  if (!link) throw new ChoreZoneMismatchError();

  db.delete(choreSchedules).where(eq(choreSchedules.choreZoneId, link.id)).run();
}

// Any member can view — same as chores/zones themselves. Fetched as one flat list
// (own-chore schedules unioned with zone-link schedules) rather than attached to each
// chore, since a household's total schedule count is small and this keeps
// choreService.ts's read path untouched.
export function listSchedulesForHousehold(
  householdId: number,
  requestingUserId: number,
): ScheduleWithTarget[] {
  requireMembership(householdId, requestingUserId);
  const timeZone = getHouseholdTimezone(householdId);

  const ownChoreRows = db
    .select({ schedule: choreSchedules, choreId: chores.id })
    .from(choreSchedules)
    .innerJoin(chores, eq(chores.id, choreSchedules.choreId))
    .where(eq(chores.householdId, householdId))
    .all();

  const zoneLinkRows = db
    .select({ schedule: choreSchedules, choreId: choreZones.choreId, zoneId: choreZones.zoneId })
    .from(choreSchedules)
    .innerJoin(choreZones, eq(choreZones.id, choreSchedules.choreZoneId))
    .innerJoin(chores, eq(chores.id, choreZones.choreId))
    .where(eq(chores.householdId, householdId))
    .all();

  return [
    ...ownChoreRows.map((row) => ({ ...toSummary(row.schedule, timeZone), choreId: row.choreId, zoneId: null })),
    ...zoneLinkRows.map((row) => ({
      ...toSummary(row.schedule, timeZone),
      choreId: row.choreId,
      zoneId: row.zoneId,
    })),
  ];
}
```

Note: `inArray` is imported but unused in this version — remove it from the import line (it was needed in an earlier draft of this task; the final queries above use `innerJoin` instead). Double-check the import line reads:

```typescript
import { and, eq } from 'drizzle-orm';
```

- [ ] **Step 3: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/errors.ts backend/src/services/scheduleService.ts
git commit -m "feat: add scheduleService for chore/zone schedule CRUD"
```

(This task's actual behavior is verified in Task 7, where routes exercise every function above through real HTTP requests.)

---

## Task 7: Schedule routes on the chores router

**Files:**
- Modify: `backend/src/routes/chores.ts`
- Modify: `backend/src/routes/chores.test.ts`

**Interfaces:**
- Consumes: everything produced by Task 6.

- [ ] **Step 1: Write failing route tests**

Add to `backend/src/routes/chores.test.ts`, as a new `describe` block near the end of the file (after the existing status-related describes), reusing the file's existing `registerHeadOfHousehold`/`registerAndJoin`/`getRootZoneId`/`createZone` helpers:

```typescript
describe('chore schedules', () => {
  it('lets the head set a one-off schedule on a zoneless chore', async () => {
    const head = await registerHeadOfHousehold('sched-hoh@example.com', 'Schedule House');
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Water plants', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;

    const response = await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'once', startDate: '2026-06-01', startTime: '09:00' });

    expect(response.status).toBe(200);
    expect(response.body.schedule).toEqual({
      recurrenceType: 'once',
      startDate: '2026-06-01',
      startTime: '09:00',
      intervalDays: null,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      nextRunAt: expect.any(Number),
    });
  });

  it('lets the head set a weekly schedule on a specific chore zone', async () => {
    const head = await registerHeadOfHousehold('sched-zone-hoh@example.com', 'Schedule Zone House');
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    const kitchenZoneId = await createZone(head.householdId, head.cookie, 'Kitchen', rootZoneId);
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Wipe counters', zoneIds: [kitchenZoneId] });
    const choreId = choreResponse.body.chore.id;

    const response = await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/zones/${kitchenZoneId}/schedule`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'weekly',
        startDate: '2026-06-01',
        startTime: '18:00',
        intervalWeeks: 1,
        weekdays: [1, 4],
      });

    expect(response.status).toBe(200);
    expect(response.body.schedule.recurrenceType).toBe('weekly');
    expect(response.body.schedule.weekdays).toEqual([1, 4]);
  });

  it('rejects setting a whole-chore schedule when the chore has zones', async () => {
    const head = await registerHeadOfHousehold('sched-mismatch-hoh@example.com', 'Mismatch House');
    const rootZoneId = await getRootZoneId(head.householdId, head.cookie);
    const kitchenZoneId = await createZone(head.householdId, head.cookie, 'Kitchen', rootZoneId);
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Zoned chore', zoneIds: [kitchenZoneId] });
    const choreId = choreResponse.body.chore.id;

    const response = await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'once', startDate: '2026-06-01', startTime: '09:00' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ChoreScheduleManagedByZones');
  });

  it('rejects a non-head member with 403', async () => {
    const head = await registerHeadOfHousehold('sched-member-hoh@example.com', 'Member Schedule House');
    const member = await registerAndJoin('sched-member@example.com', head);
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Not yours to schedule', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;

    const response = await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', member.cookie)
      .send({ recurrenceType: 'once', startDate: '2026-06-01', startTime: '09:00' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('removes a schedule', async () => {
    const head = await registerHeadOfHousehold('sched-remove-hoh@example.com', 'Remove Schedule House');
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Take out recycling', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;
    await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'once', startDate: '2026-06-01', startTime: '09:00' });

    const response = await request(app)
      .delete(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(204);

    const listResponse = await request(app)
      .get(`/api/households/${head.householdId}/chores/schedules`)
      .set('Cookie', head.cookie);
    expect(listResponse.body.schedules).toEqual([]);
  });

  it('lists every schedule for the household, tagged with its target', async () => {
    const head = await registerHeadOfHousehold('sched-list-hoh@example.com', 'List Schedule House');
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Listed chore', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;
    await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', startDate: '2026-06-01', startTime: '09:00', intervalDays: 2 });

    const response = await request(app)
      .get(`/api/households/${head.householdId}/chores/schedules`)
      .set('Cookie', head.cookie);

    expect(response.status).toBe(200);
    expect(response.body.schedules).toEqual([
      expect.objectContaining({ choreId, zoneId: null, recurrenceType: 'every_n_days' }),
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/routes/chores.test.ts`
Expected: FAIL — none of the schedule routes exist yet.

- [ ] **Step 3: Implement the routes**

In `backend/src/routes/chores.ts`, update the imports:

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import { householdParamsSchema } from '../validation/householdSchemas.js';
import {
  assignChoreSchema,
  assignmentParamsSchema,
  choreParamsSchema,
  choreZoneParamsSchema,
  createChoreSchema,
  setChoreStatusSchema,
} from '../validation/choreSchemas.js';
import { setScheduleSchema } from '../validation/scheduleSchemas.js';
import * as choreService from '../services/choreService.js';
import * as scheduleService from '../services/scheduleService.js';
```

Then add, at the end of the file:

```typescript
choresRouter.get('/:householdId/chores/schedules', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = householdParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household id', parsed.error.issues));
    return;
  }

  try {
    const schedules = scheduleService.listSchedulesForHousehold(parsed.data.householdId, req.user.id);
    res.status(200).json({ schedules });
  } catch (err) {
    next(err);
  }
});

choresRouter.put('/:householdId/chores/:choreId/schedule', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = choreParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household or chore id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = setScheduleSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid schedule', bodyParsed.error.issues));
    return;
  }

  try {
    const schedule = scheduleService.setScheduleForChore(
      paramsParsed.data.householdId,
      paramsParsed.data.choreId,
      req.user.id,
      bodyParsed.data,
    );
    res.status(200).json({ schedule });
  } catch (err) {
    next(err);
  }
});

choresRouter.delete('/:householdId/chores/:choreId/schedule', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = choreParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household or chore id', paramsParsed.error.issues));
    return;
  }

  try {
    scheduleService.removeScheduleForChore(paramsParsed.data.householdId, paramsParsed.data.choreId, req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

choresRouter.put('/:householdId/chores/:choreId/zones/:zoneId/schedule', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = choreZoneParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid ids', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = setScheduleSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid schedule', bodyParsed.error.issues));
    return;
  }

  try {
    const schedule = scheduleService.setScheduleForChoreZone(
      paramsParsed.data.householdId,
      paramsParsed.data.choreId,
      paramsParsed.data.zoneId,
      req.user.id,
      bodyParsed.data,
    );
    res.status(200).json({ schedule });
  } catch (err) {
    next(err);
  }
});

choresRouter.delete('/:householdId/chores/:choreId/zones/:zoneId/schedule', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = choreZoneParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid ids', paramsParsed.error.issues));
    return;
  }

  try {
    scheduleService.removeScheduleForChoreZone(
      paramsParsed.data.householdId,
      paramsParsed.data.choreId,
      paramsParsed.data.zoneId,
      req.user.id,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run src/routes/chores.test.ts`
Expected: PASS.

- [ ] **Step 5: Full backend verification, commit**

Run: `cd backend && npm run typecheck && npm run lint && npm test`
Expected: all PASS.

```bash
git add backend/src/routes/chores.ts backend/src/routes/chores.test.ts
git commit -m "feat: add chore/zone schedule routes"
```

---

## Task 8: `choreScheduler.ts` — the polling scheduler

**Files:**
- Create: `backend/src/services/choreScheduler.ts`
- Create: `backend/src/services/choreScheduler.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `advanceUntilFuture` from `./scheduleTime.js` (Task 2); `systemReopenChore`/`systemReopenChoreZone` from `./choreService.js` (Task 5); `choreSchedules`, `choreZones`, `chores`, `households` tables.
- Produces: `checkSchedules(now?: number): void`, `startChoreScheduler(): void`, `stopChoreScheduler(): void`.

- [ ] **Step 1: Write failing tests**

Create `backend/src/services/choreScheduler.test.ts`, following the exact harness pattern in `dailyReminderScheduler.test.ts` (tmp SQLite file, real migrations, mocked `choreService`):

```typescript
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

const systemReopenChore = vi.fn();
const systemReopenChoreZone = vi.fn();
vi.mock('./choreService.js', () => ({ systemReopenChore, systemReopenChoreZone }));

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-chore-scheduler-'));
process.env.DB_FILE = join(testDir, 'test.db');

const { runMigrations, sqlite, db } = await import('../db/client.js');
const { households, chores, choreZones, choreSchedules, zones } = await import('../db/schema.js');
const { checkSchedules } = await import('./choreScheduler.js');

runMigrations();

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

let householdId: number;
let choreId: number;
let zoneId: number;
let choreZoneRowId: number;

beforeEach(() => {
  systemReopenChore.mockReset();
  systemReopenChoreZone.mockReset();
  db.delete(choreSchedules).run();
  db.delete(choreZones).run();
  db.delete(chores).run();
  db.delete(zones).run();
  db.delete(households).run();

  const now = Date.now();
  householdId = db
    .insert(households)
    .values({ name: 'Scheduler House', joinCode: `SCHED${now}`, createdByUserId: 1, timezone: 'UTC', createdAt: now })
    .returning({ id: households.id })
    .get().id;
  choreId = db
    .insert(chores)
    .values({ householdId, name: 'Scheduled chore', status: 'complete', createdAt: now })
    .returning({ id: chores.id })
    .get().id;
  zoneId = db
    .insert(zones)
    .values({ householdId, parentZoneId: null, name: 'Root', createdAt: now })
    .returning({ id: zones.id })
    .get().id;
  choreZoneRowId = db
    .insert(choreZones)
    .values({ choreId, zoneId, status: 'complete' })
    .returning({ id: choreZones.id })
    .get().id;
});

function insertSchedule(overrides: {
  choreId?: number | null;
  choreZoneId?: number | null;
  nextRunAt: number;
}) {
  const now = Date.now();
  return db
    .insert(choreSchedules)
    .values({
      choreId: overrides.choreId ?? null,
      choreZoneId: overrides.choreZoneId ?? null,
      recurrenceType: 'every_n_days',
      startAt: overrides.nextRunAt,
      intervalDays: 1,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
      nextRunAt: overrides.nextRunAt,
      createdAt: now,
    })
    .returning({ id: choreSchedules.id })
    .get();
}

describe('checkSchedules', () => {
  it('reopens a zoneless chore whose schedule is due', () => {
    const schedule = insertSchedule({ choreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemReopenChore.mockReturnValue(true);

    checkSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemReopenChore).toHaveBeenCalledWith(choreId);
    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.nextRunAt).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });

  it('reopens a specific chore zone whose schedule is due', () => {
    const schedule = insertSchedule({ choreZoneId: choreZoneRowId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemReopenChoreZone.mockReturnValue(true);

    checkSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemReopenChoreZone).toHaveBeenCalledWith(choreId, zoneId);
    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.nextRunAt).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });

  it('does nothing before nextRunAt', () => {
    insertSchedule({ choreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });

    checkSchedules(Date.UTC(2026, 0, 1, 8, 0));

    expect(systemReopenChore).not.toHaveBeenCalled();
  });

  it('clears nextRunAt for a fired one-off schedule', () => {
    const now = Date.now();
    const schedule = db
      .insert(choreSchedules)
      .values({
        choreId,
        choreZoneId: null,
        recurrenceType: 'once',
        startAt: Date.UTC(2026, 0, 1, 9, 0),
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
        nextRunAt: Date.UTC(2026, 0, 1, 9, 0),
        createdAt: now,
      })
      .returning({ id: choreSchedules.id })
      .get();
    systemReopenChore.mockReturnValue(true);

    checkSchedules(Date.UTC(2026, 0, 1, 9, 0));

    const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
    expect(row?.nextRunAt).toBeNull();
  });

  it('still advances nextRunAt when the firing rule was a no-op (e.g. already overdue)', () => {
    insertSchedule({ choreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });
    systemReopenChore.mockReturnValue(false); // e.g. the chore was 'overdue', not 'complete'

    checkSchedules(Date.UTC(2026, 0, 1, 9, 0));

    expect(systemReopenChore).toHaveBeenCalledWith(choreId);
    const schedules = db.select().from(choreSchedules).all();
    expect(schedules[0]?.nextRunAt).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/services/choreScheduler.test.ts`
Expected: FAIL — `choreScheduler.ts` doesn't exist yet.

- [ ] **Step 3: Implement `choreScheduler.ts`**

Create `backend/src/services/choreScheduler.ts`:

```typescript
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { choreSchedules, choreZones, chores, households } from '../db/schema.js';
import { advanceUntilFuture } from './scheduleTime.js';
import type { ScheduleRecurrence } from './scheduleTime.js';
import { systemReopenChore, systemReopenChoreZone } from './choreService.js';

const CHECK_INTERVAL_MS = 60_000;

type ScheduleRow = typeof choreSchedules.$inferSelect;

function toRecurrence(row: ScheduleRow): ScheduleRecurrence {
  return {
    recurrenceType: row.recurrenceType,
    startAt: row.startAt,
    intervalDays: row.intervalDays,
    intervalWeeks: row.intervalWeeks,
    weekdays: row.weekdays ? (JSON.parse(row.weekdays) as number[]) : null,
    intervalMonths: row.intervalMonths,
    dayOfMonth: row.dayOfMonth,
  };
}

// Resolves a schedule row to the {choreId, zoneId} it actually targets — choreId
// directly for a whole-chore schedule, or via a lookup on chore_zones for a
// zone-specific one (see chore_schedules' "exactly one of choreId/choreZoneId" rule
// in schema.ts). Returns null if the target has since been deleted (a race between
// this query and the chore/zone's removal) — the caller skips such a row silently.
function resolveTarget(row: ScheduleRow): { choreId: number; zoneId: number | null } | null {
  if (row.choreId !== null) return { choreId: row.choreId, zoneId: null };
  if (row.choreZoneId === null) return null;
  const link = db
    .select({ choreId: choreZones.choreId, zoneId: choreZones.zoneId })
    .from(choreZones)
    .where(eq(choreZones.id, row.choreZoneId))
    .get();
  return link ?? null;
}

function householdTimezoneForChore(choreId: number): string {
  const chore = db.select({ householdId: chores.householdId }).from(chores).where(eq(chores.id, choreId)).get();
  if (!chore) return 'UTC';
  const household = db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, chore.householdId))
    .get();
  return household?.timezone ?? 'UTC';
}

// Exported (and accepting `now` rather than reading Date.now() internally) so it's
// directly testable — same rationale as dailyReminderScheduler.ts's
// checkDailyReminders.
export function checkSchedules(now: number = Date.now()): void {
  const due = db
    .select()
    .from(choreSchedules)
    .where(and(isNotNull(choreSchedules.nextRunAt), lte(choreSchedules.nextRunAt, now)))
    .all();

  for (const row of due) {
    const target = resolveTarget(row);
    if (!target) continue;

    // The firing rule itself (flip 'complete' -> 'to-do', leave 'overdue'/'to-do'
    // alone) lives in choreService's systemReopenChore/systemReopenChoreZone — this
    // loop doesn't need to know or care whether it was a no-op.
    if (target.zoneId === null) {
      systemReopenChore(target.choreId);
    } else {
      systemReopenChoreZone(target.choreId, target.zoneId);
    }

    const nextRunAt =
      row.recurrenceType === 'once'
        ? null
        : advanceUntilFuture(toRecurrence(row), householdTimezoneForChore(target.choreId), now, row.nextRunAt!);

    db.update(choreSchedules).set({ nextRunAt }).where(eq(choreSchedules.id, row.id)).run();
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startChoreScheduler(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => checkSchedules(), CHECK_INTERVAL_MS);
}

export function stopChoreScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx vitest run src/services/choreScheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `index.ts`**

In `backend/src/index.ts`, add the import:

```typescript
import { startChoreScheduler } from './services/choreScheduler.js';
```

And add, after the existing `startDailyReminderScheduler();` line:

```typescript
// Same reasoning as startDailyReminderScheduler above: started here, not in
// createApp(), so no test spins up a real recurring interval.
startChoreScheduler();
```

- [ ] **Step 6: Full backend verification, commit**

Run: `cd backend && npm run typecheck && npm run lint && npm test`
Expected: all PASS.

```bash
git add backend/src/services/choreScheduler.ts backend/src/services/choreScheduler.test.ts backend/src/index.ts
git commit -m "feat: add polling scheduler for automated chore/zone reopen"
```

---

## Task 9: Frontend — types and API clients

**Files:**
- Create: `frontend/src/types/schedule.ts`
- Create: `frontend/src/api/scheduleApi.ts`
- Modify: `frontend/src/api/householdApi.ts`

**Interfaces:**
- Produces: `RecurrenceType`, `Schedule`, `ScheduleInput`, `ScheduleWithTarget` types; `listSchedules`, `setChoreSchedule`, `removeChoreSchedule`, `setChoreZoneSchedule`, `removeChoreZoneSchedule` API functions; `householdApi.syncTimezone`.

No test file — this project has no frontend test suite (see Global Constraints); verified by `npm run typecheck` here and manually in Task 13.

- [ ] **Step 1: Add the types**

Create `frontend/src/types/schedule.ts`:

```typescript
export type RecurrenceType = 'once' | 'every_n_days' | 'weekly' | 'monthly';

export interface Schedule {
  recurrenceType: RecurrenceType;
  startDate: string; // YYYY-MM-DD, in the household's own timezone
  startTime: string; // HH:MM
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null; // 0 (Sunday) - 6 (Saturday)
  intervalMonths: number | null;
  nextRunAt: number | null;
}

export interface ScheduleWithTarget extends Schedule {
  choreId: number;
  zoneId: number | null;
}

export type ScheduleInput =
  | { recurrenceType: 'once'; startDate: string; startTime: string }
  | { recurrenceType: 'every_n_days'; startDate: string; startTime: string; intervalDays: number }
  | {
      recurrenceType: 'weekly';
      startDate: string;
      startTime: string;
      intervalWeeks: number;
      weekdays: number[];
    }
  | { recurrenceType: 'monthly'; startDate: string; startTime: string; intervalMonths: number };
```

- [ ] **Step 2: Add the API client**

Create `frontend/src/api/scheduleApi.ts`:

```typescript
import { apiRequest } from './httpClient';
import type { Schedule, ScheduleInput, ScheduleWithTarget } from '../types/schedule';

export async function listSchedules(householdId: number): Promise<ScheduleWithTarget[]> {
  const response = await apiRequest<{ schedules: ScheduleWithTarget[] }>(
    `/api/households/${householdId}/chores/schedules`,
  );
  return response.schedules;
}

export async function setChoreSchedule(
  householdId: number,
  choreId: number,
  input: ScheduleInput,
): Promise<Schedule> {
  const response = await apiRequest<{ schedule: Schedule }>(
    `/api/households/${householdId}/chores/${choreId}/schedule`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
  return response.schedule;
}

export async function removeChoreSchedule(householdId: number, choreId: number): Promise<void> {
  await apiRequest<void>(`/api/households/${householdId}/chores/${choreId}/schedule`, { method: 'DELETE' });
}

export async function setChoreZoneSchedule(
  householdId: number,
  choreId: number,
  zoneId: number,
  input: ScheduleInput,
): Promise<Schedule> {
  const response = await apiRequest<{ schedule: Schedule }>(
    `/api/households/${householdId}/chores/${choreId}/zones/${zoneId}/schedule`,
    { method: 'PUT', body: JSON.stringify(input) },
  );
  return response.schedule;
}

export async function removeChoreZoneSchedule(
  householdId: number,
  choreId: number,
  zoneId: number,
): Promise<void> {
  await apiRequest<void>(
    `/api/households/${householdId}/chores/${choreId}/zones/${zoneId}/schedule`,
    { method: 'DELETE' },
  );
}
```

- [ ] **Step 3: Add the timezone sync function**

Add to `frontend/src/api/householdApi.ts`:

```typescript
export async function syncTimezone(householdId: number, timezone: string): Promise<void> {
  await apiRequest<void>(`/api/households/${householdId}/timezone`, {
    method: 'PATCH',
    body: JSON.stringify({ timezone }),
  });
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

```bash
git add frontend/src/types/schedule.ts frontend/src/api/scheduleApi.ts frontend/src/api/householdApi.ts
git commit -m "feat: add frontend types and API clients for chore schedules"
```

---

## Task 10: Frontend — `ChoreScheduleForm` and `ChoreScheduleControl`

**Files:**
- Create: `frontend/src/components/household/ChoreScheduleForm.tsx`
- Create: `frontend/src/components/household/ChoreScheduleControl.tsx`

**Interfaces:**
- Consumes: `Schedule`, `ScheduleInput`, `RecurrenceType` from `../../types/schedule`.
- Produces: `ChoreScheduleControl` — a self-contained "current schedule summary + edit toggle" unit that Task 11 drops into `ChoreRow`/`ChoreZoneSection`.

- [ ] **Step 1: Write `ChoreScheduleForm`**

Create `frontend/src/components/household/ChoreScheduleForm.tsx`:

```typescript
import { useState, type FormEvent } from 'react';
import type { RecurrenceType, Schedule, ScheduleInput } from '../../types/schedule';
import { FormField } from '../common/FormField';

interface ChoreScheduleFormProps {
  schedule: Schedule | null;
  submitting: boolean;
  onSave: (input: ScheduleInput) => void;
  onCancel: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ChoreScheduleForm({ schedule, submitting, onSave, onCancel }: ChoreScheduleFormProps) {
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(schedule?.recurrenceType ?? 'once');
  const [startDate, setStartDate] = useState(schedule?.startDate ?? '');
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '09:00');
  const [intervalDays, setIntervalDays] = useState(schedule?.intervalDays ?? 1);
  const [intervalWeeks, setIntervalWeeks] = useState(schedule?.intervalWeeks ?? 1);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(schedule?.weekdays ?? []));
  const [intervalMonths, setIntervalMonths] = useState(schedule?.intervalMonths ?? 1);

  function toggleWeekday(day: number) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!startDate) return;

    switch (recurrenceType) {
      case 'once':
        onSave({ recurrenceType, startDate, startTime });
        return;
      case 'every_n_days':
        onSave({ recurrenceType, startDate, startTime, intervalDays });
        return;
      case 'weekly':
        if (weekdays.size === 0) return;
        onSave({ recurrenceType, startDate, startTime, intervalWeeks, weekdays: [...weekdays] });
        return;
      case 'monthly':
        onSave({ recurrenceType, startDate, startTime, intervalMonths });
        return;
    }
  }

  return (
    <form className="chore-schedule-form" onSubmit={handleSubmit}>
      <label className="schedule-field">
        Repeats
        <select
          value={recurrenceType}
          onChange={(event) => setRecurrenceType(event.target.value as RecurrenceType)}
        >
          <option value="once">Once</option>
          <option value="every_n_days">Every few days</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>

      <FormField label="Start date" name="scheduleStartDate" type="date" value={startDate} onChange={setStartDate} required />
      <FormField label="Time" name="scheduleStartTime" type="time" value={startTime} onChange={setStartTime} required />

      {recurrenceType === 'every_n_days' && (
        <label className="schedule-field">
          Every
          <input
            type="number"
            min={1}
            max={365}
            value={intervalDays}
            onChange={(event) => setIntervalDays(Number(event.target.value))}
          />
          day(s)
        </label>
      )}

      {recurrenceType === 'weekly' && (
        <>
          <label className="schedule-field">
            Every
            <input
              type="number"
              min={1}
              max={52}
              value={intervalWeeks}
              onChange={(event) => setIntervalWeeks(Number(event.target.value))}
            />
            week(s) on
          </label>
          <div className="weekday-picker">
            {WEEKDAY_LABELS.map((label, day) => (
              <label key={day} className="weekday-picker-option">
                <input type="checkbox" checked={weekdays.has(day)} onChange={() => toggleWeekday(day)} />
                {label}
              </label>
            ))}
          </div>
        </>
      )}

      {recurrenceType === 'monthly' && (
        <label className="schedule-field">
          Every
          <input
            type="number"
            min={1}
            max={24}
            value={intervalMonths}
            onChange={(event) => setIntervalMonths(Number(event.target.value))}
          />
          month(s), on the day of month above
        </label>
      )}

      <div className="schedule-form-actions">
        <button type="submit" className="btn btn-pill-outline" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save schedule'}
        </button>
        <button type="button" className="btn btn-text" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Write `ChoreScheduleControl`**

Create `frontend/src/components/household/ChoreScheduleControl.tsx`:

```typescript
import { useState } from 'react';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import { ChoreScheduleForm } from './ChoreScheduleForm';

interface ChoreScheduleControlProps {
  schedule: Schedule | null;
  isHead: boolean;
  submitting: boolean;
  onSave: (input: ScheduleInput) => void;
  onRemove: () => void;
}

const RECURRENCE_SUMMARY: Record<Schedule['recurrenceType'], (schedule: Schedule) => string> = {
  once: (schedule) => `Scheduled for ${schedule.startDate}`,
  every_n_days: (schedule) => `Repeats every ${schedule.intervalDays} day(s)`,
  weekly: (schedule) => `Repeats every ${schedule.intervalWeeks} week(s)`,
  monthly: (schedule) => `Repeats every ${schedule.intervalMonths} month(s)`,
};

export function ChoreScheduleControl({
  schedule,
  isHead,
  submitting,
  onSave,
  onRemove,
}: ChoreScheduleControlProps) {
  const [editing, setEditing] = useState(false);

  if (!isHead && !schedule) return null;

  if (editing) {
    return (
      <ChoreScheduleForm
        schedule={schedule}
        submitting={submitting}
        onSave={(input) => {
          onSave(input);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="chore-schedule-control">
      {schedule && <span className="chore-schedule-summary">{RECURRENCE_SUMMARY[schedule.recurrenceType](schedule)}</span>}
      {isHead && (
        <button type="button" className="btn btn-text" onClick={() => setEditing(true)}>
          {schedule ? 'Edit schedule' : 'Add schedule'}
        </button>
      )}
      {isHead && schedule && (
        <button type="button" className="btn btn-text" disabled={submitting} onClick={onRemove}>
          Remove schedule
        </button>
      )}
    </div>
  );
}
```

`FormField` (`frontend/src/components/common/FormField.tsx`) already accepts a `type` prop (defaulting to `'text'`), so `ChoreScheduleForm`'s `type="date"`/`type="time"` usage above needs no changes there.

- [ ] **Step 3: Typecheck and commit**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

```bash
git add frontend/src/components/household/ChoreScheduleForm.tsx frontend/src/components/household/ChoreScheduleControl.tsx
git commit -m "feat: add chore schedule form and control components"
```

---

## Task 11: Frontend — wire `ChoreScheduleControl` into `ChoreRow` and `ChoreZoneSection`

**Files:**
- Modify: `frontend/src/components/household/ChoreRow.tsx`
- Modify: `frontend/src/components/household/ChoreZoneSection.tsx`

**Interfaces:**
- Consumes: `ChoreScheduleControl` (Task 10).
- Produces: new props threaded through both components — `scheduleByTarget` (a lookup), `scheduleSubmittingKey`, `onSetSchedule`, `onRemoveSchedule` — consumed by Task 12's `ChoresList`/`HouseholdCard` wiring, using the same `${choreId}:${zoneId ?? 'none'}` key convention already used for `statusUpdatingKey`/`assigningKey` elsewhere in these files.

- [ ] **Step 1: Update `ChoreRow.tsx`**

In `frontend/src/components/household/ChoreRow.tsx`, add the import:

```typescript
import { ChoreScheduleControl } from './ChoreScheduleControl';
import type { Schedule, ScheduleInput } from '../../types/schedule';
```

Add to `ChoreRowProps`:

```typescript
  scheduleByTarget: Map<string, Schedule>;
  scheduleSubmittingKey: string | null;
  onSetSchedule: (choreId: number, zoneId: number | null, input: ScheduleInput) => void;
  onRemoveSchedule: (choreId: number, zoneId: number | null) => void;
```

Add to the function's destructured params (matching the props above), then inside the component, after `const isUpdatingStatus = ...`:

```typescript
  const scheduleKey = `${chore.id}:none`;
```

And render, right after the `{!hasZones && <ChoreStatusActions ... />}` block:

```typescript
      {!hasZones && (
        <ChoreScheduleControl
          schedule={scheduleByTarget.get(scheduleKey) ?? null}
          isHead={isHead}
          submitting={scheduleSubmittingKey === scheduleKey}
          onSave={(input) => onSetSchedule(chore.id, null, input)}
          onRemove={() => onRemoveSchedule(chore.id, null)}
        />
      )}
```

Thread the four new props down into each `ChoreZoneSection` in the `hasZones` branch:

```typescript
            <ChoreZoneSection
              key={zone.zoneId}
              choreId={chore.id}
              zone={zone}
              zoneName={zoneNameById.get(zone.zoneId) ?? 'Unknown zone'}
              assignments={assignmentsFor(zone.zoneId)}
              members={members}
              currentUserId={currentUserId}
              isHead={isHead}
              assigningKey={assigningKey}
              onAssign={onAssign}
              unassigningId={unassigningId}
              onUnassign={onUnassign}
              statusUpdatingKey={statusUpdatingKey}
              onSetStatus={onSetStatus}
              scheduleByTarget={scheduleByTarget}
              scheduleSubmittingKey={scheduleSubmittingKey}
              onSetSchedule={onSetSchedule}
              onRemoveSchedule={onRemoveSchedule}
            />
```

- [ ] **Step 2: Update `ChoreZoneSection.tsx`**

In `frontend/src/components/household/ChoreZoneSection.tsx`, add the import:

```typescript
import { ChoreScheduleControl } from './ChoreScheduleControl';
import type { Schedule, ScheduleInput } from '../../types/schedule';
```

Add to `ChoreZoneSectionProps`:

```typescript
  scheduleByTarget: Map<string, Schedule>;
  scheduleSubmittingKey: string | null;
  onSetSchedule: (choreId: number, zoneId: number | null, input: ScheduleInput) => void;
  onRemoveSchedule: (choreId: number, zoneId: number | null) => void;
```

Add to the destructured params, then inside the component, after `const isUpdatingStatus = ...`:

```typescript
  const scheduleKey = `${choreId}:${zone.zoneId}`;
```

And render, inside the `{expanded && (<div className="chore-zone-body">...)}` block, right after `<ChoreStatusActions ... />`:

```typescript
          <ChoreScheduleControl
            schedule={scheduleByTarget.get(scheduleKey) ?? null}
            isHead={isHead}
            submitting={scheduleSubmittingKey === scheduleKey}
            onSave={(input) => onSetSchedule(choreId, zone.zoneId, input)}
            onRemove={() => onRemoveSchedule(choreId, zone.zoneId)}
          />
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: FAIL at this point — `ChoresList.tsx`/`HouseholdCard.tsx` don't yet supply the new required props. That's expected; Task 12 fixes it. Confirm the *only* errors are "missing prop" errors on `ChoreRow`'s callers, not anything inside the files just edited.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/household/ChoreRow.tsx frontend/src/components/household/ChoreZoneSection.tsx
git commit -m "feat: wire schedule control into chore/zone rows"
```

---

## Task 12: Frontend — `ChoresList` passthrough and `HouseholdCard` wiring

**Files:**
- Modify: `frontend/src/components/household/ChoresList.tsx`
- Modify: `frontend/src/components/household/HouseholdCard.tsx`

**Interfaces:**
- Consumes: everything from Task 9 (`scheduleApi`) and Task 11 (new `ChoreRow` props).

- [ ] **Step 1: Update `ChoresList.tsx`**

In `frontend/src/components/household/ChoresList.tsx`, add the import:

```typescript
import type { Schedule, ScheduleInput } from '../../types/schedule';
```

Add to `ChoresListProps`:

```typescript
  scheduleByTarget: Map<string, Schedule>;
  scheduleSubmittingKey: string | null;
  onSetSchedule: (choreId: number, zoneId: number | null, input: ScheduleInput) => void;
  onRemoveSchedule: (choreId: number, zoneId: number | null) => void;
```

Add to the destructured params and pass through to `<ChoreRow ... />`:

```typescript
          scheduleByTarget={scheduleByTarget}
          scheduleSubmittingKey={scheduleSubmittingKey}
          onSetSchedule={onSetSchedule}
          onRemoveSchedule={onRemoveSchedule}
```

- [ ] **Step 2: Update `HouseholdCard.tsx`**

In `frontend/src/components/household/HouseholdCard.tsx`, add imports:

```typescript
import * as scheduleApi from '../../api/scheduleApi';
import type { Schedule, ScheduleInput, ScheduleWithTarget } from '../../types/schedule';
```

Add state, alongside the existing `useState` calls:

```typescript
  const [schedules, setSchedules] = useState<ScheduleWithTarget[]>([]);
  const [scheduleSubmittingKey, setScheduleSubmittingKey] = useState<string | null>(null);
```

Add a data-loading effect, alongside the existing `zoneApi`/`choreApi`/`householdApi` effects:

```typescript
  useEffect(() => {
    let cancelled = false;
    scheduleApi
      .listSchedules(household.id)
      .then((result) => {
        if (!cancelled) setSchedules(result);
      })
      .catch(() => {
        // Same rationale as the members fetch above: schedules are secondary to
        // viewing chores, so a failure here shouldn't block the page.
      });
    return () => {
      cancelled = true;
    };
  }, [household.id]);
```

Add a timezone-sync effect (fire-and-forget, mirroring `NotificationOptIn`'s silent resync):

```typescript
  useEffect(() => {
    void householdApi.syncTimezone(household.id, Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [household.id]);
```

Add the derived lookup map, alongside where `isHead`/other derived values are computed near the bottom of the component (before the `return`):

```typescript
  const scheduleByTarget = new Map<string, Schedule>(
    schedules.map((schedule) => [`${schedule.choreId}:${schedule.zoneId ?? 'none'}`, schedule]),
  );
```

Add the two handlers, alongside `handleSetStatus`/`handleRemoveChore`:

```typescript
  async function handleSetSchedule(choreId: number, zoneId: number | null, input: ScheduleInput) {
    const key = `${choreId}:${zoneId ?? 'none'}`;
    setScheduleSubmittingKey(key);
    setAssignError(null);
    try {
      const updated =
        zoneId === null
          ? await scheduleApi.setChoreSchedule(household.id, choreId, input)
          : await scheduleApi.setChoreZoneSchedule(household.id, choreId, zoneId, input);
      setSchedules((prev) => [
        ...prev.filter((schedule) => !(schedule.choreId === choreId && schedule.zoneId === zoneId)),
        { ...updated, choreId, zoneId },
      ]);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not save that schedule.');
    } finally {
      setScheduleSubmittingKey(null);
    }
  }

  async function handleRemoveSchedule(choreId: number, zoneId: number | null) {
    const key = `${choreId}:${zoneId ?? 'none'}`;
    setScheduleSubmittingKey(key);
    setAssignError(null);
    try {
      if (zoneId === null) {
        await scheduleApi.removeChoreSchedule(household.id, choreId);
      } else {
        await scheduleApi.removeChoreZoneSchedule(household.id, choreId, zoneId);
      }
      setSchedules((prev) => prev.filter((schedule) => !(schedule.choreId === choreId && schedule.zoneId === zoneId)));
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not remove that schedule.');
    } finally {
      setScheduleSubmittingKey(null);
    }
  }
```

Pass the new props into `<ChoresList ... />`:

```typescript
          scheduleByTarget={scheduleByTarget}
          scheduleSubmittingKey={scheduleSubmittingKey}
          onSetSchedule={(choreId, zoneId, input) => void handleSetSchedule(choreId, zoneId, input)}
          onRemoveSchedule={(choreId, zoneId) => void handleRemoveSchedule(choreId, zoneId)}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/household/ChoresList.tsx frontend/src/components/household/HouseholdCard.tsx
git commit -m "feat: wire chore scheduling end to end in the household view"
```

---

## Task 13: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the isolated dev servers**

Run: `npm run dev:ai` from the repo root (never `npm run dev` — see `CLAUDE.md`).

- [ ] **Step 2: Manual walkthrough**

Using the browser (`http://localhost:4173`):
1. Register a new household as its head.
2. Create a zoneless chore.
3. Open it and add a schedule (try `every_n_days` with `intervalDays: 1` and a `startDate`/`startTime` a couple of minutes in the future, in your machine's local date/time — the household's timezone will have been captured automatically from your browser).
4. Mark the chore `complete`.
5. Wait for the scheduled time to pass (the poller checks every 60 seconds) and confirm the chore flips back to `to-do` on its own without a page reload triggering it (refresh to check).
6. Mark it `overdue` (as the head), then wait for the *next* scheduled occurrence to pass — confirm it stays `overdue` (not silently reset to `to-do`), per the firing rule.
7. Create a chore with a zone, and repeat steps 3-6 against that zone's own schedule via the zone's "Edit schedule" control, confirming it's independent of any whole-chore schedule.
8. Remove a schedule and confirm the indicator disappears and the chore stops auto-flipping.

- [ ] **Step 3: Stop the dev servers by port**

Run:
```bash
lsof -tiTCP:4001 -sTCP:LISTEN | xargs -r kill
lsof -tiTCP:4173 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 4: Full workspace verification**

Run:
```bash
cd backend && npm run typecheck && npm run lint && npm test
cd ../frontend && npm run typecheck && npm run lint
```
Expected: all PASS.

- [ ] **Step 5: Post-change review**

Per `CLAUDE.md`'s "Post-change review workflow," do three separate re-reads of the full diff (`git diff main...feat/scheduling`) — correctness, architecture, security — before considering this phase done.
