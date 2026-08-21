# Overdue timer (scheduling phase 2) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a head attach an optional overdue timer (an amount of minutes/hours/days
since a chore/chore-zone's most recent transition into `to-do`) to any schedule,
including saved schedule templates, and have it automatically fire.

**Architecture:** Two new nullable columns on `chore_schedules`
(`overdueAfterAmount`/`overdueAfterUnit`, the configured duration) plus one more
(`overdueAt`, a precomputed "check at" instant — same role as the existing
`nextRunAt`). Two new nullable `todoSince` columns on `chores`/`chore_zones` track
"when did this last become `to-do`", updated at every real transition into `to-do`.
`overdueAt` is recomputed whenever `todoSince` changes (if a timer is configured) or
whenever a schedule with a timer is created/replaced. `choreScheduler.ts`'s existing
60-second poll gains a second due-query that flips `to-do` → `overdue` when
`overdueAt` has passed, reusing the existing manual-overdue notification path.

**Tech Stack:** Same as the rest of the backend/frontend — Drizzle ORM/SQLite, Zod,
Express, React, Vitest. No new dependencies.

## Global Constraints

- The overdue timer always rides on an existing `chore_schedules` row — there is no
  standalone timer without a schedule (confirmed design decision).
- Duration is stored exactly as entered (amount + unit), never normalized to a single
  minutes value (confirmed design decision).
- Only a *real* transition into `to-do` (from a different status, or at creation)
  updates `todoSince` — a redundant `to-do` → `to-do` write is a no-op (confirmed
  design decision).
- Schedule templates (`schedule_patterns` table / `ScheduleTemplate` type) carry the
  same optional timer fields (confirmed design decision).
- No live countdown anywhere in the UI — only the static configured duration is ever
  displayed (confirmed design decision).
- No DB-level `CHECK` constraint enforcing `overdueAfterAmount`/`overdueAfterUnit`
  co-nullability, unlike `chore_schedules`' existing exactly-one-target `CHECK`. This
  is a deliberate deviation from the design doc's wording ("enforced by a CHECK
  constraint mirroring the existing pattern"): both columns are only ever written
  together by one code path each (`scheduleService.insertSchedule` /
  `scheduleTemplateService.createScheduleTemplate`), already guaranteed paired by Zod
  before either function runs. Adding the CHECK would force SQLite to recreate
  `chore_schedules`/`schedule_patterns` (SQLite's `ALTER TABLE` cannot add a
  table-level `CHECK` after the fact) — extra migration risk (per CLAUDE.md's
  table-recreation warning) for an invariant that's already fully controlled by a
  single writer. Plain `ADD COLUMN` migrations only.
- `npm run typecheck`, `npm run lint`, and `npm test` (backend) must pass after every
  task, per CLAUDE.md.
- Every new file uses the design tokens in `frontend/src/index.css` — no hardcoded
  colors/fonts.

---

### Task 1: Data model — schema + migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/drizzle/0015_<generated-name>.sql` (via `npm run db:generate`,
  then hand-edited)

**Interfaces:**
- Produces: `OVERDUE_AFTER_UNITS` / `OverdueAfterUnit` (exported from `schema.ts`),
  and the new columns every later task reads/writes:
  `choreSchedules.overdueAfterAmount` (`integer`, nullable),
  `choreSchedules.overdueAfterUnit` (`text` enum, nullable),
  `choreSchedules.overdueAt` (`integer`, nullable, indexed),
  `chores.todoSince` (`integer`, nullable), `choreZones.todoSince` (`integer`,
  nullable), `scheduleTemplates.overdueAfterAmount` / `.overdueAfterUnit` (same
  shape as `choreSchedules`').

- [ ] **Step 1: Add the new columns to `schema.ts`**

  Add near `RECURRENCE_TYPES` (just above the `choreSchedules` table definition):

  ```ts
  export const OVERDUE_AFTER_UNITS = ['minutes', 'hours', 'days'] as const;
  export type OverdueAfterUnit = (typeof OVERDUE_AFTER_UNITS)[number];
  ```

  In the `chores` table definition, add a column after `status`:

  ```ts
    // Epoch ms, nullable: the instant this chore's status most recently changed
    // *into* 'to-do' (including at creation, since a chore defaults to 'to-do') —
    // never touched by a redundant 'to-do' -> 'to-do' write. Drives an overdue
    // timer's `overdueAt` (see chore_schedules.overdueAt) when one is configured;
    // otherwise unused. See choreService.ts for every write site.
    todoSince: integer('todo_since'),
  ```

  In the `choreZones` table definition, add the identical column (same comment,
  s/chore/chore-zone/):

  ```ts
    // Same role as chores.todoSince, but for this specific zone-link — see that
    // column's comment.
    todoSince: integer('todo_since'),
  ```

  In the `choreSchedules` table definition, add three columns after `dayOfMonth`
  (before `nextRunAt`):

  ```ts
    // The configured overdue timer, if any: both null together (no timer) or both
    // set together (never enforced by a DB CHECK — see the plan's Global
    // Constraints for why; both are always written together by
    // scheduleService.insertSchedule).
    overdueAfterAmount: integer('overdue_after_amount'),
    overdueAfterUnit: text('overdue_after_unit', { enum: OVERDUE_AFTER_UNITS }),
    // Epoch ms, nullable, indexed: precomputed "check at" instant for the overdue
    // timer, mirroring nextRunAt's role for the reopen schedule — recomputed
    // whenever the target's todoSince changes (see choreService.ts /
    // scheduleService.refreshOverdueAtForTarget) or a new schedule with a timer is
    // saved. Cleared to null once choreScheduler.ts's overdue poll has checked it,
    // whether or not it actually fired — this is a one-shot deadline, not a
    // repeating cadence like nextRunAt.
    overdueAt: integer('overdue_at'),
  ```

  Add an index for it in `choreSchedules`' extra-config array (alongside the
  existing `chore_schedules_next_run_at_idx`):

  ```ts
    index('chore_schedules_overdue_at_idx').on(table.overdueAt),
  ```

  In the `scheduleTemplates` table definition, add two columns after `dayOfMonth`:

  ```ts
    // Same shape as chore_schedules' overdueAfterAmount/overdueAfterUnit — applying
    // this template pre-fills the overdue timer along with the recurrence shape.
    // No overdueAt here: a template is never itself evaluated by the scheduler,
    // same reasoning already applied to it having no startAt/nextRunAt.
    overdueAfterAmount: integer('overdue_after_amount'),
    overdueAfterUnit: text('overdue_after_unit', { enum: OVERDUE_AFTER_UNITS }),
  ```

- [ ] **Step 2: Generate the migration**

  Run: `npm run db:generate`

  This produces `backend/drizzle/0015_<random-name>.sql` with six
  `ALTER TABLE ... ADD ...` statements (no table recreation — none of these columns
  have a DB-level `CHECK`, `NOT NULL`, or `UNIQUE` constraint, so plain `ADD COLUMN`
  suffices) plus one `CREATE INDEX` for `overdueAt`.

- [ ] **Step 3: Hand-edit the migration to backfill `todoSince`**

  Existing rows have no real history to derive a "became to-do" instant from. Open
  the generated `0015_*.sql` and append two backfill statements (after the
  `chores`/`chore_zones` `ADD todo_since` lines, before or after the rest — order
  among independent `ALTER`/`UPDATE` statements on different tables doesn't matter
  here), each separated by `--> statement-breakpoint` like every other multi-statement
  migration in this repo:

  ```sql
  UPDATE `chores` SET `todo_since` = (unixepoch() * 1000) WHERE `status` = 'to-do';--> statement-breakpoint
  UPDATE `chore_zones` SET `todo_since` = (unixepoch() * 1000) WHERE `status` = 'to-do';
  ```

  Add a comment at the very top of the file (same convention as migration `0005`)
  explaining why:

  ```sql
  -- Hand-edited from drizzle-kit's generated output: todo_since has no way to know
  -- a pre-existing to-do chore/zone's *real* transition instant, so this backfills
  -- the migration's own run time for anything currently 'to-do' — a reasonable
  -- "the clock starts now" default. complete/overdue rows are left NULL; they get a
  -- real todoSince the next time they actually transition into 'to-do' (see
  -- choreService.ts).
  ```

- [ ] **Step 4: Verify the migration against a scratch copy of a real database**

  Per CLAUDE.md: never trust the raw `sqlite3` CLI for this — it runs in autocommit
  mode and won't reproduce drizzle's transaction-wrapped migration behavior. Instead:

  ```bash
  cp backend/data/chore-tracker.ai.db /tmp/migration-verify.db 2>/dev/null || echo "no ai db yet, will verify against a fresh one instead"
  DB_FILE=/tmp/migration-verify.db npx tsx -e "import('./src/db/client.js').then(m => m.runMigrations())"
  ```

  Run from `backend/`. Expected: no errors, exits cleanly. If `chore-tracker.ai.db`
  doesn't exist yet (no prior `dev:ai` run), this instead verifies migration 0015
  runs cleanly against a brand-new database — still confirms the SQL is syntactically
  and semantically valid, just without a "backfill against real to-do rows" case;
  that path is separately covered by Task 5's `choreService.test.ts` inserting rows
  and running `runMigrations()` for real (every backend test does this already).

- [ ] **Step 5: Typecheck and commit**

  ```bash
  cd backend && npm run typecheck
  ```

  Expected: passes (no service code references the new columns yet, so this only
  checks `schema.ts` itself is well-typed).

  ```bash
  git add backend/src/db/schema.ts backend/drizzle/0015_*.sql backend/drizzle/meta/
  git commit -m "Adds overdue-timer columns to chore_schedules/schedule_patterns and todoSince tracking columns"
  ```

---

### Task 2: `scheduleTime.ts` — pure duration math

**Files:**
- Modify: `backend/src/services/scheduleTime.ts`
- Modify: `backend/src/services/scheduleTime.test.ts`

**Interfaces:**
- Produces: `overdueDurationMs(amount: number, unit: OverdueAfterUnit): number` —
  consumed by Task 4 (`scheduleService.ts`) and Task 5 (`choreService.ts`).

- [ ] **Step 1: Write the failing tests**

  Add to `backend/src/services/scheduleTime.test.ts` (alongside its existing
  `describe` blocks — check the file's current imports first; it already imports
  from `./scheduleTime.js`, just add `overdueDurationMs` to that import list):

  ```ts
  describe('overdueDurationMs', () => {
    it('converts minutes to ms', () => {
      expect(overdueDurationMs(90, 'minutes')).toBe(90 * 60 * 1000);
    });

    it('converts hours to ms', () => {
      expect(overdueDurationMs(3, 'hours')).toBe(3 * 60 * 60 * 1000);
    });

    it('converts days to ms', () => {
      expect(overdueDurationMs(2, 'days')).toBe(2 * 24 * 60 * 60 * 1000);
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd backend && npx vitest run scheduleTime.test.ts`
  Expected: FAIL — `overdueDurationMs is not defined` / not exported.

- [ ] **Step 3: Implement `overdueDurationMs`**

  Add to `backend/src/services/scheduleTime.ts`, near the top (after the
  `LocalDateTime`/`ScheduleRecurrence` interfaces, before `formatPart`):

  ```ts
  import type { OverdueAfterUnit } from '../db/schema.js';
  export type { OverdueAfterUnit };

  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS_FOR_OVERDUE = 24 * HOUR_MS;

  // Plain duration math, deliberately with no timezone/calendar involvement — unlike
  // every_n_days/weekly/monthly, a minutes/hours/days overdue timer is a fixed-length
  // span from an instant, not a calendar-relative step.
  export function overdueDurationMs(amount: number, unit: OverdueAfterUnit): number {
    switch (unit) {
      case 'minutes':
        return amount * MINUTE_MS;
      case 'hours':
        return amount * HOUR_MS;
      case 'days':
        return amount * DAY_MS_FOR_OVERDUE;
    }
  }
  ```

  Note: this file already defines its own `DAY_MS` constant further down (used by
  the calendar-stepping functions) — `DAY_MS_FOR_OVERDUE` is named distinctly to
  avoid a duplicate-identifier collision, even though the values are identical; they
  represent different concepts (a calendar day-step vs. a fixed 24h span) and
  shouldn't be conflated into one shared constant.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd backend && npx vitest run scheduleTime.test.ts`
  Expected: PASS, including all pre-existing tests in that file.

- [ ] **Step 5: Typecheck, lint, commit**

  ```bash
  cd backend && npm run typecheck && npm run lint
  git add src/services/scheduleTime.ts src/services/scheduleTime.test.ts
  git commit -m "Adds overdueDurationMs pure duration helper"
  ```

---

### Task 3: `scheduleSchemas.ts` — overdue-timer validation

**Files:**
- Modify: `backend/src/validation/scheduleSchemas.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `overdueAfterUnitSchema` (exported, reused by Task 7's
  `scheduleTemplateSchemas.ts`), and every `setScheduleSchema` variant gains an
  optional `overdueAfter: { amount: number; unit: OverdueAfterUnit } | undefined`.

- [ ] **Step 1: Add the shared overdue-timer schema**

  In `backend/src/validation/scheduleSchemas.ts`, add after the existing
  `weekdaySchema` export:

  ```ts
  export const overdueAfterUnitSchema = z.enum(['minutes', 'hours', 'days']);

  const overdueAfterSchema = z
    .object({
      amount: z.number().int().min(1).max(999),
      unit: overdueAfterUnitSchema,
    })
    .optional();
  ```

- [ ] **Step 2: Add `overdueAfter` to every recurrence variant**

  Update each of the four variant schemas to include it:

  ```ts
  const onceScheduleSchema = z.object({
    recurrenceType: z.literal('once'),
    startDate: startDateSchema,
    startTime: startTimeSchema,
    overdueAfter: overdueAfterSchema,
  });

  const everyNDaysScheduleSchema = z.object({
    recurrenceType: z.literal('every_n_days'),
    startDate: startDateSchema,
    startTime: startTimeSchema,
    intervalDays: z.number().int().min(1).max(365),
    overdueAfter: overdueAfterSchema,
  });

  const weeklyScheduleSchema = z.object({
    recurrenceType: z.literal('weekly'),
    startDate: startDateSchema,
    startTime: startTimeSchema,
    intervalWeeks: z.number().int().min(1).max(52),
    weekdays: z.array(weekdaySchema).min(1).max(7),
    overdueAfter: overdueAfterSchema,
  });

  const monthlyScheduleSchema = z.object({
    recurrenceType: z.literal('monthly'),
    startDate: startDateSchema,
    startTime: startTimeSchema,
    intervalMonths: z.number().int().min(1).max(24),
    overdueAfter: overdueAfterSchema,
  });
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  cd backend && npm run typecheck
  ```

  Expected: passes. `SetScheduleInput` (the inferred type) now carries an optional
  `overdueAfter` on every variant — nothing downstream reads it yet, so no other
  file breaks.

- [ ] **Step 4: Commit**

  ```bash
  git add src/validation/scheduleSchemas.ts
  git commit -m "Adds optional overdueAfter field to schedule validation"
  ```

---

### Task 4: `scheduleService.ts` — persist and read the overdue timer

**Files:**
- Modify: `backend/src/services/scheduleService.ts`
- Modify: `backend/src/routes/chores.test.ts`

**Interfaces:**
- Consumes: `overdueDurationMs` (Task 2), `SetScheduleInput.overdueAfter` (Task 3).
- Produces: `ScheduleSummary.overdueAfter` / `ScheduleWithTarget.overdueAfter`
  (`{ amount: number; unit: OverdueAfterUnit } | null`) — read by Task 8's frontend
  types. `refreshOverdueAtForTarget(choreId, zoneId, todoSince)` — an exported
  function Task 5's `choreService.ts` calls after every real transition into `to-do`.

- [ ] **Step 1: Write the failing route tests**

  In `backend/src/routes/chores.test.ts`, add two imports needed by the new
  "computes overdueAt immediately" test below (`db`/`choreSchedules` aren't
  currently imported in this file — everything else it needs, `eq`, is already
  available via `drizzle-orm`). Add near the top of the file, right after the
  existing `import request from 'supertest';` line:

  ```ts
  import { eq } from 'drizzle-orm';
  ```

  And right after the existing `const { runMigrations, sqlite } = await
  import('../db/client.js');` line, widen that same import and add the schema one:

  ```ts
  const { runMigrations, sqlite, db } = await import('../db/client.js');
  const { choreSchedules } = await import('../db/schema.js');
  const { createApp } = await import('../app.js');
  ```

  Then update the first schedule test's exact `toEqual` (around line 1300) to
  include the new field — every other assertion in that block already uses
  `objectContaining`/spot-checks, so only this one needs editing:

  ```ts
    expect(response.body.schedule).toEqual({
      recurrenceType: 'once',
      startDate: '2030-06-01',
      startTime: '09:00',
      intervalDays: null,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      overdueAfter: null,
      nextRunAt: expect.any(Number),
    });
  ```

  Add new tests in the same `describe('chore schedules', ...)` block, after the
  existing "lists every schedule" test:

  ```ts
  it('sets an overdue timer alongside a schedule', async () => {
    const head = await registerHeadOfHousehold('sched-overdue-hoh@example.com', 'Overdue Timer House');
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Take out trash', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;

    const response = await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'once',
        startDate: '2030-06-01',
        startTime: '09:00',
        overdueAfter: { amount: 2, unit: 'days' },
      });

    expect(response.status).toBe(200);
    expect(response.body.schedule.overdueAfter).toEqual({ amount: 2, unit: 'days' });
  });

  it('computes overdueAt immediately when the target is already to-do', async () => {
    const head = await registerHeadOfHousehold('sched-overdue-now-hoh@example.com', 'Overdue Now House');
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Fresh to-do chore', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;
    const before = Date.now();

    const response = await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'once',
        startDate: '2030-06-01',
        startTime: '09:00',
        overdueAfter: { amount: 90, unit: 'minutes' },
      });

    expect(response.status).toBe(200);
    // A brand-new chore is 'to-do' from creation, so overdueAt should already be
    // computed (todoSince ~= creation time) rather than waiting for a later
    // transition. overdueAt itself isn't in the API response (see design's "no
    // live countdown" decision) — assert indirectly via the DB.
    const row = db.select().from(choreSchedules).where(eq(choreSchedules.choreId, choreId)).get();
    expect(row?.overdueAt).toBeGreaterThanOrEqual(before + 90 * 60 * 1000);
  });

  it('rejects an overdue timer amount outside 1-999 with 400', async () => {
    const head = await registerHeadOfHousehold('sched-overdue-invalid-hoh@example.com', 'Invalid Overdue House');
    const choreResponse = await request(app)
      .post(`/api/households/${head.householdId}/chores`)
      .set('Cookie', head.cookie)
      .send({ name: 'Chore', zoneIds: [] });
    const choreId = choreResponse.body.chore.id;

    const response = await request(app)
      .put(`/api/households/${head.householdId}/chores/${choreId}/schedule`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'once',
        startDate: '2030-06-01',
        startTime: '09:00',
        overdueAfter: { amount: 1000, unit: 'days' },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('ValidationError');
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd backend && npx vitest run chores.test.ts`
  Expected: FAIL — the exact-shape test fails on a missing `overdueAfter` key, and
  the new tests fail since `overdueAfter`/`overdueAt` aren't wired up yet.

- [ ] **Step 3: Update `scheduleService.ts`**

  Add imports at the top:

  ```ts
  import type { ChoreStatus, RecurrenceType } from '../db/schema.js';
  import { overdueDurationMs } from './scheduleTime.js';
  import type { OverdueAfterUnit } from './scheduleTime.js';
  ```

  (Replace the existing `import type { RecurrenceType } from '../db/schema.js';`
  line with the combined one above.)

  Update `ScheduleSummary`:

  ```ts
  export interface ScheduleSummary {
    recurrenceType: RecurrenceType;
    startDate: string;
    startTime: string;
    intervalDays: number | null;
    intervalWeeks: number | null;
    weekdays: number[] | null;
    intervalMonths: number | null;
    overdueAfter: { amount: number; unit: OverdueAfterUnit } | null;
    nextRunAt: number | null;
  }
  ```

  Update `toSummary` to populate it (add before the `return` statement's
  `nextRunAt: row.nextRunAt` line — field order in the returned object should match
  the interface above for readability, so insert `overdueAfter` right before
  `nextRunAt`):

  ```ts
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
      overdueAfter:
        row.overdueAfterAmount !== null && row.overdueAfterUnit !== null
          ? { amount: row.overdueAfterAmount, unit: row.overdueAfterUnit }
          : null,
      nextRunAt: row.nextRunAt,
    };
  }
  ```

  Update `findChoreInHousehold` to also select `status`/`todoSince` (needed to
  compute the initial `overdueAt`):

  ```ts
  function findChoreInHousehold(householdId: number, choreId: number) {
    return db
      .select({ id: chores.id, status: chores.status, todoSince: chores.todoSince })
      .from(chores)
      .where(and(eq(chores.id, choreId), eq(chores.householdId, householdId)))
      .get();
  }
  ```

  Update `insertSchedule` to accept the target's current status/todoSince and
  compute `overdueAt`:

  ```ts
  function insertSchedule(
    target: { choreId: number; choreZoneId: null } | { choreId: null; choreZoneId: number },
    input: SetScheduleInput,
    timeZone: string,
    currentStatus: ChoreStatus,
    todoSince: number | null,
  ): ScheduleSummary {
    const [year, month, day] = input.startDate.split('-').map(Number) as [number, number, number];
    const [hour, minute] = input.startTime.split(':').map(Number) as [number, number];
    const startAt = fromLocalDateTime({ year, month, day, hour, minute }, timeZone);

    const values = buildRowValues(input);
    const recurrence = toRecurrence(startAt, values);
    const nextRunAt = computeInitialNextRunAt(recurrence, timeZone, Date.now());

    // Only meaningful while the target is currently 'to-do' — if it's 'complete' or
    // 'overdue', there's nothing to count down from yet (see the design's firing
    // rule: overdueAt gets computed fresh the next time the target actually becomes
    // 'to-do', via choreService.ts calling refreshOverdueAtForTarget). Falls back to
    // "now" if todoSince is somehow null despite being 'to-do' — shouldn't happen
    // after the migration 0015 backfill, but costs nothing to guard.
    const effectiveTodoSince = currentStatus === 'to-do' ? todoSince ?? Date.now() : null;
    const overdueAt =
      input.overdueAfter && effectiveTodoSince !== null
        ? effectiveTodoSince + overdueDurationMs(input.overdueAfter.amount, input.overdueAfter.unit)
        : null;
    const overdueValues = input.overdueAfter
      ? { overdueAfterAmount: input.overdueAfter.amount, overdueAfterUnit: input.overdueAfter.unit, overdueAt }
      : { overdueAfterAmount: null, overdueAfterUnit: null, overdueAt: null };

    const row = db.transaction((tx) => {
      if (target.choreId !== null) {
        tx.delete(choreSchedules).where(eq(choreSchedules.choreId, target.choreId)).run();
      } else {
        tx.delete(choreSchedules).where(eq(choreSchedules.choreZoneId, target.choreZoneId)).run();
      }
      return tx
        .insert(choreSchedules)
        .values({ ...target, startAt, ...values, ...overdueValues, nextRunAt, createdAt: Date.now() })
        .returning()
        .get();
    });

    return toSummary(row, timeZone);
  }
  ```

  Update `setScheduleForChore` to pass the chore's current status/todoSince:

  ```ts
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

    return insertSchedule(
      { choreId, choreZoneId: null },
      input,
      getHouseholdTimezone(householdId),
      chore.status,
      chore.todoSince,
    );
  }
  ```

  Update `setScheduleForChoreZone` similarly — its `link` select needs
  `status`/`todoSince` too:

  ```ts
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
      .select({ id: choreZones.id, status: choreZones.status, todoSince: choreZones.todoSince })
      .from(choreZones)
      .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
      .get();
    if (!link) throw new ChoreZoneMismatchError();

    return insertSchedule(
      { choreId: null, choreZoneId: link.id },
      input,
      getHouseholdTimezone(householdId),
      link.status,
      link.todoSince,
    );
  }
  ```

  Add the new exported function `refreshOverdueAtForTarget` (place it after
  `insertSchedule`, before `setScheduleForChore`):

  ```ts
  // Called by choreService.ts after any real transition into 'to-do' (never on a
  // redundant to-do -> to-do write). No-ops if the target has no schedule row, or
  // its schedule has no overdue timer configured — there's nothing to recompute.
  export function refreshOverdueAtForTarget(
    choreId: number,
    zoneId: number | null,
    todoSince: number,
  ): void {
    const scheduleRowId =
      zoneId === null
        ? db.select({ id: choreSchedules.id }).from(choreSchedules).where(eq(choreSchedules.choreId, choreId)).get()
            ?.id
        : (() => {
            const link = db
              .select({ id: choreZones.id })
              .from(choreZones)
              .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
              .get();
            if (!link) return undefined;
            return db
              .select({ id: choreSchedules.id })
              .from(choreSchedules)
              .where(eq(choreSchedules.choreZoneId, link.id))
              .get()?.id;
          })();
    if (scheduleRowId === undefined) return;

    const schedule = db
      .select({ overdueAfterAmount: choreSchedules.overdueAfterAmount, overdueAfterUnit: choreSchedules.overdueAfterUnit })
      .from(choreSchedules)
      .where(eq(choreSchedules.id, scheduleRowId))
      .get()!;
    if (schedule.overdueAfterAmount === null || schedule.overdueAfterUnit === null) return;

    const overdueAt = todoSince + overdueDurationMs(schedule.overdueAfterAmount, schedule.overdueAfterUnit);
    db.update(choreSchedules).set({ overdueAt }).where(eq(choreSchedules.id, scheduleRowId)).run();
  }
  ```

  Update `ScheduleWithTarget` — no change needed, it already `extends ScheduleSummary`
  so it inherits `overdueAfter` automatically.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd backend && npx vitest run chores.test.ts`
  Expected: PASS.

- [ ] **Step 5: Typecheck, lint, full test suite, commit**

  ```bash
  cd backend && npm run typecheck && npm run lint && npm test
  git add src/services/scheduleService.ts src/routes/chores.test.ts
  git commit -m "Persists and reads the overdue timer on chore schedules"
  ```

---

### Task 5: `choreService.ts` — todoSince tracking and the overdue transition

**Files:**
- Modify: `backend/src/services/choreService.ts`
- Create: `backend/src/services/choreService.test.ts`

**Interfaces:**
- Consumes: `refreshOverdueAtForTarget` (Task 4).
- Produces: `systemMarkOverdue(choreId: number): boolean` and
  `systemMarkOverdueZone(choreId: number, zoneId: number): boolean` — consumed by
  Task 6's `choreScheduler.ts`. `todoSince` is now correctly maintained on every
  status write, a precondition every later task's overdue-firing behavior depends on.

- [ ] **Step 1: Write the failing unit tests**

  Create `backend/src/services/choreService.test.ts`. This is the first direct unit
  test file for this service (existing coverage is only via route-level
  `chores.test.ts`) — needed because `todoSince`/`overdueAt` aren't exposed through
  the API, so only a direct-DB test can observe them. Mirrors
  `choreScheduler.test.ts`'s scratch-DB setup style:

  ```ts
  import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { eq } from 'drizzle-orm';

  vi.mock('./notificationBatcher.js', () => ({
    queueOverdueNotification: vi.fn(),
    queueReopenedNotification: vi.fn(),
    queueAssignmentNotification: vi.fn(),
  }));
  const { queueOverdueNotification, queueReopenedNotification } = await import('./notificationBatcher.js');

  const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-chore-service-'));
  process.env.DB_FILE = join(testDir, 'test.db');

  const { runMigrations, sqlite, db } = await import('../db/client.js');
  const { users, households, chores, choreZones, choreSchedules, zones } = await import('../db/schema.js');
  const choreService = await import('./choreService.js');

  runMigrations();

  afterAll(() => {
    sqlite.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  let userId: number;
  let householdId: number;

  beforeAll(() => {
    userId = db
      .insert(users)
      .values({ username: 'chore-owner', email: 'chore-owner@example.com', passwordHash: 'x', createdAt: Date.now() })
      .returning({ id: users.id })
      .get().id;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db.delete(choreSchedules).run();
    db.delete(choreZones).run();
    db.delete(chores).run();
    db.delete(zones).run();
    db.delete(households).run();

    const now = Date.now();
    householdId = db
      .insert(households)
      .values({ name: 'Chore House', joinCode: `CHORE${now}`, createdByUserId: userId, timezone: 'UTC', createdAt: now })
      .returning({ id: households.id })
      .get().id;
  });

  function insertChore(status: 'to-do' | 'complete' | 'overdue' = 'to-do', todoSince: number | null = null) {
    const now = Date.now();
    return db
      .insert(chores)
      .values({ householdId, name: 'Test chore', status, todoSince, createdAt: now })
      .returning({ id: chores.id })
      .get().id;
  }

  function insertZone() {
    const now = Date.now();
    return db
      .insert(zones)
      .values({ householdId, parentZoneId: null, name: 'Root', createdAt: now })
      .returning({ id: zones.id })
      .get().id;
  }

  function insertChoreZone(choreId: number, zoneId: number, status: 'to-do' | 'complete' | 'overdue', todoSince: number | null = null) {
    return db.insert(choreZones).values({ choreId, zoneId, status, todoSince }).returning({ id: choreZones.id }).get().id;
  }

  function insertScheduleWithOverdueTimer(target: { choreId?: number; choreZoneId?: number }, amount: number, unit: 'minutes' | 'hours' | 'days') {
    const now = Date.now();
    return db
      .insert(choreSchedules)
      .values({
        choreId: target.choreId ?? null,
        choreZoneId: target.choreZoneId ?? null,
        recurrenceType: 'once',
        startAt: now,
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
        overdueAfterAmount: amount,
        overdueAfterUnit: unit,
        overdueAt: null,
        nextRunAt: null,
        createdAt: now,
      })
      .returning({ id: choreSchedules.id })
      .get();
  }

  describe('createChore', () => {
    it('sets todoSince on the new chore and its zone links', () => {
      const zoneId = insertZone();
      const before = Date.now();
      const chore = choreService.createChore(householdId, userId, 'New chore', [zoneId]);
      const choreRow = db.select().from(chores).where(eq(chores.id, chore.id)).get()!;
      expect(choreRow.todoSince).toBeGreaterThanOrEqual(before);
      const zoneRow = db.select().from(choreZones).where(eq(choreZones.choreId, chore.id)).get()!;
      expect(zoneRow.todoSince).toBeGreaterThanOrEqual(before);
    });
  });

  describe('setChoreStatus', () => {
    it('sets todoSince when transitioning complete -> to-do', () => {
      const choreId = insertChore('complete', 1000);
      const before = Date.now();

      choreService.setChoreStatus(householdId, choreId, userId, 'to-do');

      const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
      expect(row.todoSince).toBeGreaterThanOrEqual(before);
    });

    it('leaves todoSince untouched on a redundant to-do -> to-do write', () => {
      const choreId = insertChore('to-do', 1000);

      choreService.setChoreStatus(householdId, choreId, userId, 'to-do');

      const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
      expect(row.todoSince).toBe(1000);
    });

    it('leaves todoSince untouched when transitioning away from to-do', () => {
      const choreId = insertChore('to-do', 1000);

      choreService.setChoreStatus(householdId, choreId, userId, 'complete');

      const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
      expect(row.todoSince).toBe(1000);
    });

    it('recomputes overdueAt on the chore\'s schedule when it becomes to-do', () => {
      const choreId = insertChore('complete', null);
      const schedule = insertScheduleWithOverdueTimer({ choreId }, 2, 'hours');
      const before = Date.now();

      choreService.setChoreStatus(householdId, choreId, userId, 'to-do');

      const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get()!;
      expect(row.overdueAt).toBeGreaterThanOrEqual(before + 2 * 60 * 60 * 1000);
    });
  });

  describe('setChoreZoneStatus', () => {
    it('sets todoSince on the zone link when transitioning complete -> to-do', () => {
      const choreId = insertChore('to-do');
      const zoneId = insertZone();
      insertChoreZone(choreId, zoneId, 'complete', 1000);
      const before = Date.now();

      choreService.setChoreZoneStatus(householdId, choreId, zoneId, userId, 'to-do');

      const row = db.select().from(choreZones).where(eq(choreZones.choreId, choreId)).get()!;
      expect(row.todoSince).toBeGreaterThanOrEqual(before);
    });
  });

  describe('systemReopenChore', () => {
    it('sets todoSince and recomputes overdueAt when reopening', () => {
      const choreId = insertChore('complete', null);
      const schedule = insertScheduleWithOverdueTimer({ choreId }, 30, 'minutes');
      const before = Date.now();

      const result = choreService.systemReopenChore(choreId);

      expect(result).toBe(true);
      const choreRow = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
      expect(choreRow.todoSince).toBeGreaterThanOrEqual(before);
      const scheduleRow = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get()!;
      expect(scheduleRow.overdueAt).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
    });

    it('does nothing when the chore is not complete', () => {
      const choreId = insertChore('overdue', 1000);

      const result = choreService.systemReopenChore(choreId);

      expect(result).toBe(false);
      const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
      expect(row.todoSince).toBe(1000);
    });
  });

  describe('systemMarkOverdue', () => {
    it('flips a to-do chore to overdue and notifies assignees', () => {
      const choreId = insertChore('to-do', Date.now());

      const result = choreService.systemMarkOverdue(choreId);

      expect(result).toBe(true);
      const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
      expect(row.status).toBe('overdue');
    });

    it('does nothing if the chore is no longer to-do', () => {
      const choreId = insertChore('complete', Date.now());

      const result = choreService.systemMarkOverdue(choreId);

      expect(result).toBe(false);
      const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
      expect(row.status).toBe('complete');
    });

    it('leaves todoSince untouched (only the status changes)', () => {
      const choreId = insertChore('to-do', 1000);

      choreService.systemMarkOverdue(choreId);

      const row = db.select().from(chores).where(eq(chores.id, choreId)).get()!;
      expect(row.todoSince).toBe(1000);
    });
  });

  describe('systemMarkOverdueZone', () => {
    it('flips a to-do zone link to overdue', () => {
      const choreId = insertChore('to-do');
      const zoneId = insertZone();
      insertChoreZone(choreId, zoneId, 'to-do', Date.now());

      const result = choreService.systemMarkOverdueZone(choreId, zoneId);

      expect(result).toBe(true);
      const row = db.select().from(choreZones).where(eq(choreZones.choreId, choreId)).get()!;
      expect(row.status).toBe('overdue');
    });
  });
  ```

  Note: `queueOverdueNotification`/`queueReopenedNotification` are imported but not
  asserted on in every test above — they're mocked purely so the real
  `notificationBatcher.js` (which reads `VAPID_*` env vars and would otherwise print
  console warnings) never loads. Feel free to add explicit
  `expect(queueOverdueNotification).toHaveBeenCalled()`-style assertions if useful,
  but they're not required for this task's core behavior (todoSince/overdueAt).

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd backend && npx vitest run choreService.test.ts`
  Expected: FAIL — `systemMarkOverdue`/`systemMarkOverdueZone` don't exist yet, and
  `todoSince` isn't written anywhere yet.

- [ ] **Step 3: Update `choreService.ts`**

  Add an import at the top:

  ```ts
  import { refreshOverdueAtForTarget } from './scheduleService.js';
  ```

  Update `createChore`'s transaction body to set `todoSince` alongside `createdAt`
  on both inserts:

  ```ts
  const now = Date.now();
  const chore = db.transaction((tx) => {
    const inserted = tx
      .insert(chores)
      .values({ householdId, name, todoSince: now, createdAt: now })
      .returning()
      .get();

    if (uniqueZoneIds.length > 0) {
      tx.insert(choreZones)
        .values(uniqueZoneIds.map((zoneId) => ({ choreId: inserted.id, zoneId, todoSince: now })))
        .run();
    }

    return inserted;
  });
  ```

  Update `setChoreStatus` to track `todoSince` and refresh `overdueAt` on a real
  transition into `to-do`:

  ```ts
  export function setChoreStatus(
    householdId: number,
    choreId: number,
    requestingUserId: number,
    status: ChoreStatus,
  ): ChoreSummary {
    const role = requireMembership(householdId, requestingUserId);
    if (status === 'overdue' && role !== 'head') throw new NotHeadOfHouseholdError();

    const chore = findChoreInHousehold(householdId, choreId);
    if (!chore) throw new ChoreNotFoundError();

    const anyZoneLink = db
      .select({ id: choreZones.id })
      .from(choreZones)
      .where(eq(choreZones.choreId, choreId))
      .get();
    if (anyZoneLink) throw new ChoreStatusManagedByZonesError();

    const previousStatus = chore.status;
    const becomingToDo = status === 'to-do' && previousStatus !== 'to-do';
    const now = Date.now();
    db.update(chores)
      .set(becomingToDo ? { status, todoSince: now } : { status })
      .where(eq(chores.id, choreId))
      .run();
    if (becomingToDo) refreshOverdueAtForTarget(choreId, null, now);

    if (status === 'overdue') {
      notifyAssignees(choreId, null, chore.name, requestingUserId, queueOverdueNotification);
    } else if (status === 'to-do' && previousStatus === 'complete') {
      notifyAssignees(choreId, null, chore.name, requestingUserId, queueReopenedNotification);
    }

    return attachDetailsToOne({ ...chore, status });
  }
  ```

  Update `setChoreZoneStatus` the same way:

  ```ts
  export function setChoreZoneStatus(
    householdId: number,
    choreId: number,
    zoneId: number,
    requestingUserId: number,
    status: ChoreStatus,
  ): ChoreSummary {
    const role = requireMembership(householdId, requestingUserId);
    if (status === 'overdue' && role !== 'head') throw new NotHeadOfHouseholdError();

    const chore = findChoreInHousehold(householdId, choreId);
    if (!chore) throw new ChoreNotFoundError();

    const link = db
      .select({ id: choreZones.id, status: choreZones.status })
      .from(choreZones)
      .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
      .get();
    if (!link) throw new ChoreZoneMismatchError();

    const becomingToDo = status === 'to-do' && link.status !== 'to-do';
    const now = Date.now();
    db.update(choreZones)
      .set(becomingToDo ? { status, todoSince: now } : { status })
      .where(eq(choreZones.id, link.id))
      .run();
    if (becomingToDo) refreshOverdueAtForTarget(choreId, zoneId, now);

    if (status === 'overdue') {
      notifyAssignees(choreId, zoneId, chore.name, requestingUserId, queueOverdueNotification);
    } else if (status === 'to-do' && link.status === 'complete') {
      notifyAssignees(choreId, zoneId, chore.name, requestingUserId, queueReopenedNotification);
    }

    return attachDetailsToOne(chore);
  }
  ```

  Update `systemReopenChore` and `systemReopenChoreZone` — every actual flip here is
  by definition a real transition into `to-do` (they're gated on
  `status === 'complete'`, which is never `'to-do'`):

  ```ts
  export function systemReopenChore(choreId: number): boolean {
    const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
    if (!chore || chore.status !== 'complete') return false;

    const now = Date.now();
    db.update(chores).set({ status: 'to-do', todoSince: now }).where(eq(chores.id, choreId)).run();
    refreshOverdueAtForTarget(choreId, null, now);
    notifyAssignees(choreId, null, chore.name, null, queueReopenedNotification);
    return true;
  }

  export function systemReopenChoreZone(choreId: number, zoneId: number): boolean {
    const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
    if (!chore) return false;

    const link = db
      .select({ id: choreZones.id, status: choreZones.status })
      .from(choreZones)
      .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
      .get();
    if (!link || link.status !== 'complete') return false;

    const now = Date.now();
    db.update(choreZones).set({ status: 'to-do', todoSince: now }).where(eq(choreZones.id, link.id)).run();
    refreshOverdueAtForTarget(choreId, zoneId, now);
    notifyAssignees(choreId, zoneId, chore.name, null, queueReopenedNotification);
    return true;
  }
  ```

  Add the two new system functions at the end of the file, mirroring
  `systemReopenChore`/`systemReopenChoreZone`'s shape exactly:

  ```ts
  // Internal system mutation for choreScheduler.ts's overdue poll — flips a zoneless
  // chore's status from 'to-do' to 'overdue' when its overdue timer has elapsed,
  // skipping the requireMembership/head-only role check every user-facing overdue
  // transition goes through, since there's no requesting user. No-ops (returns
  // false) if the chore isn't currently 'to-do' — it may have been completed in
  // time, or already overdue via another path. Reuses the exact same
  // queueOverdueNotification path the manual "Mark overdue" action already uses, so
  // assignees are notified the same way either way.
  export function systemMarkOverdue(choreId: number): boolean {
    const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
    if (!chore || chore.status !== 'to-do') return false;

    db.update(chores).set({ status: 'overdue' }).where(eq(chores.id, choreId)).run();
    notifyAssignees(choreId, null, chore.name, null, queueOverdueNotification);
    return true;
  }

  // Same as systemMarkOverdue, but for one zone-link of a chore.
  export function systemMarkOverdueZone(choreId: number, zoneId: number): boolean {
    const chore = db.select(CHORE_ROW_COLUMNS).from(chores).where(eq(chores.id, choreId)).get();
    if (!chore) return false;

    const link = db
      .select({ id: choreZones.id, status: choreZones.status })
      .from(choreZones)
      .where(and(eq(choreZones.choreId, choreId), eq(choreZones.zoneId, zoneId)))
      .get();
    if (!link || link.status !== 'to-do') return false;

    db.update(choreZones).set({ status: 'overdue' }).where(eq(choreZones.id, link.id)).run();
    notifyAssignees(choreId, zoneId, chore.name, null, queueOverdueNotification);
    return true;
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd backend && npx vitest run choreService.test.ts`
  Expected: PASS.

- [ ] **Step 5: Run the full backend suite (regression check), typecheck, lint, commit**

  ```bash
  cd backend && npm run typecheck && npm run lint && npm test
  ```

  Expected: all pass, including `chores.test.ts` and `choreScheduler.test.ts` (the
  latter mocks `choreService.js` entirely, so it's unaffected by these internal
  changes).

  ```bash
  git add src/services/choreService.ts src/services/choreService.test.ts
  git commit -m "Tracks todoSince on every to-do transition and adds systemMarkOverdue"
  ```

---

### Task 6: `choreScheduler.ts` — the overdue poll

**Files:**
- Modify: `backend/src/services/choreScheduler.ts`
- Modify: `backend/src/services/choreScheduler.test.ts`

**Interfaces:**
- Consumes: `systemMarkOverdue`/`systemMarkOverdueZone` (Task 5).
- Produces: `checkOverdueSchedules(now?: number): void`, wired into the same
  `setInterval` `startChoreScheduler` already runs.

- [ ] **Step 1: Write the failing tests**

  Add to `backend/src/services/choreScheduler.test.ts`. First, update the mock and
  imports at the top of the file:

  ```ts
  const systemReopenChore = vi.fn();
  const systemReopenChoreZone = vi.fn();
  const systemMarkOverdue = vi.fn();
  const systemMarkOverdueZone = vi.fn();
  vi.mock('./choreService.js', () => ({
    systemReopenChore,
    systemReopenChoreZone,
    systemMarkOverdue,
    systemMarkOverdueZone,
  }));
  ```

  ```ts
  const { checkSchedules, checkOverdueSchedules } = await import('./choreScheduler.js');
  ```

  Add `systemMarkOverdue.mockReset();` and `systemMarkOverdueZone.mockReset();` to
  the existing `beforeEach`'s reset block (alongside the two existing
  `.mockReset()` calls).

  Add a new `insertScheduleWithOverdueAt` helper near the existing `insertSchedule`
  helper:

  ```ts
  function insertScheduleWithOverdueAt(overrides: {
    choreId?: number | null;
    choreZoneId?: number | null;
    overdueAt: number;
  }) {
    const now = Date.now();
    return db
      .insert(choreSchedules)
      .values({
        choreId: overrides.choreId ?? null,
        choreZoneId: overrides.choreZoneId ?? null,
        recurrenceType: 'once',
        startAt: now,
        intervalDays: null,
        intervalWeeks: null,
        weekdays: null,
        intervalMonths: null,
        dayOfMonth: null,
        overdueAfterAmount: 1,
        overdueAfterUnit: 'hours',
        overdueAt: overrides.overdueAt,
        nextRunAt: null,
        createdAt: now,
      })
      .returning({ id: choreSchedules.id })
      .get();
  }
  ```

  Add a new `describe` block after `checkSchedules`'s:

  ```ts
  describe('checkOverdueSchedules', () => {
    it('marks a zoneless chore overdue when its timer is due', () => {
      const schedule = insertScheduleWithOverdueAt({ choreId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });
      systemMarkOverdue.mockReturnValue(true);

      checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0));

      expect(systemMarkOverdue).toHaveBeenCalledWith(choreId);
      const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
      expect(row?.overdueAt).toBeNull();
    });

    it('marks a specific chore zone overdue when its timer is due', () => {
      const schedule = insertScheduleWithOverdueAt({ choreZoneId: choreZoneRowId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });
      systemMarkOverdueZone.mockReturnValue(true);

      checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0));

      expect(systemMarkOverdueZone).toHaveBeenCalledWith(choreId, zoneId);
      const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
      expect(row?.overdueAt).toBeNull();
    });

    it('does nothing before overdueAt', () => {
      insertScheduleWithOverdueAt({ choreId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });

      checkOverdueSchedules(Date.UTC(2026, 0, 1, 8, 0));

      expect(systemMarkOverdue).not.toHaveBeenCalled();
    });

    it('clears overdueAt even when the firing rule was a no-op (already completed in time)', () => {
      const schedule = insertScheduleWithOverdueAt({ choreId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });
      systemMarkOverdue.mockReturnValue(false);

      checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0));

      expect(systemMarkOverdue).toHaveBeenCalledWith(choreId);
      const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, schedule.id)).get();
      expect(row?.overdueAt).toBeNull();
    });

    it('does not touch a schedule whose overdueAt is null', () => {
      insertSchedule({ choreId, nextRunAt: Date.UTC(2026, 0, 1, 9, 0) });

      checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0));

      expect(systemMarkOverdue).not.toHaveBeenCalled();
      expect(systemMarkOverdueZone).not.toHaveBeenCalled();
    });

    it('disables a malformed row after an error instead of crashing the whole pass', () => {
      systemMarkOverdue.mockImplementation(() => {
        throw new Error('boom');
      });
      const broken = insertScheduleWithOverdueAt({ choreId, overdueAt: Date.UTC(2026, 0, 1, 9, 0) });

      expect(() => checkOverdueSchedules(Date.UTC(2026, 0, 1, 9, 0))).not.toThrow();

      const row = db.select().from(choreSchedules).where(eq(choreSchedules.id, broken.id)).get();
      expect(row?.overdueAt).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd backend && npx vitest run choreScheduler.test.ts`
  Expected: FAIL — `checkOverdueSchedules` doesn't exist yet.

- [ ] **Step 3: Implement `checkOverdueSchedules`**

  Update the import from `./choreService.js` at the top of
  `backend/src/services/choreScheduler.ts`:

  ```ts
  import { systemReopenChore, systemReopenChoreZone, systemMarkOverdue, systemMarkOverdueZone } from './choreService.js';
  ```

  Update the `and`/`isNotNull`/`lte` import from `drizzle-orm` — it's already
  imported at the top; no change needed there since the same operators are reused.

  Add the new function after `checkSchedules` (before the `intervalHandle`
  section):

  ```ts
  // A one-shot deadline check, unlike checkSchedules' repeating cadence — overdueAt
  // is cleared here regardless of outcome (fired or no-op), and only gets a new
  // value the next time the target actually becomes 'to-do' again (see
  // choreService.ts / scheduleService.refreshOverdueAtForTarget). Same per-row
  // error isolation as checkSchedules, for the same reason.
  export function checkOverdueSchedules(now: number = Date.now()): void {
    const due = db
      .select()
      .from(choreSchedules)
      .where(and(isNotNull(choreSchedules.overdueAt), lte(choreSchedules.overdueAt, now)))
      .all();

    for (const row of due) {
      try {
        const target = resolveTarget(row);
        if (!target) continue;

        if (target.zoneId === null) {
          systemMarkOverdue(target.choreId);
        } else {
          systemMarkOverdueZone(target.choreId, target.zoneId);
        }

        db.update(choreSchedules).set({ overdueAt: null }).where(eq(choreSchedules.id, row.id)).run();
      } catch (err) {
        console.error(`choreScheduler: disabling overdue timer on schedule ${row.id} after an error`, err);
        db.update(choreSchedules).set({ overdueAt: null }).where(eq(choreSchedules.id, row.id)).run();
      }
    }
  }
  ```

  Update `startChoreScheduler` to also run the new check on the same interval:

  ```ts
  export function startChoreScheduler(): void {
    if (intervalHandle) return;
    intervalHandle = setInterval(() => {
      checkSchedules();
      checkOverdueSchedules();
    }, CHECK_INTERVAL_MS);
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `cd backend && npx vitest run choreScheduler.test.ts`
  Expected: PASS, including all pre-existing `checkSchedules` tests.

- [ ] **Step 5: Typecheck, lint, full suite, commit**

  ```bash
  cd backend && npm run typecheck && npm run lint && npm test
  git add src/services/choreScheduler.ts src/services/choreScheduler.test.ts
  git commit -m "Adds the overdue-timer poll to choreScheduler"
  ```

---

### Task 7: Schedule templates carry the overdue timer

**Files:**
- Modify: `backend/src/validation/scheduleTemplateSchemas.ts`
- Modify: `backend/src/services/scheduleTemplateService.ts`
- Modify: `backend/src/routes/scheduleTemplates.test.ts`

**Interfaces:**
- Consumes: `overdueAfterUnitSchema` (Task 3).
- Produces: `CreateScheduleTemplateInput` variants gain optional `overdueAfter`;
  `ScheduleTemplate.overdueAfter` (`{ amount; unit } | null`) — read by Task 9's
  frontend.

- [ ] **Step 1: Write the failing route test**

  In `backend/src/routes/scheduleTemplates.test.ts`, update the first test's exact
  `toEqual` (the `createResponse.body.scheduleTemplate` assertion) to add
  `overdueAfter: null`:

  ```ts
    expect(createResponse.body.scheduleTemplate).toEqual({
      id: expect.any(Number),
      name: 'Daily evenings',
      recurrenceType: 'every_n_days',
      startTime: '18:00',
      intervalDays: 1,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
      overdueAfter: null,
    });
  ```

  Add a new test after the "dedupes and sorts weekly schedule template weekdays"
  test:

  ```ts
  it('carries an overdue timer on a schedule template', async () => {
    const head = await registerHeadOfHousehold('template-overdue-hoh@example.com', 'Overdue Template House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/schedule-templates`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'every_n_days',
        name: 'With overdue timer',
        startTime: '09:00',
        intervalDays: 1,
        overdueAfter: { amount: 3, unit: 'hours' },
      });

    expect(response.status).toBe(201);
    expect(response.body.scheduleTemplate.overdueAfter).toEqual({ amount: 3, unit: 'hours' });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `cd backend && npx vitest run scheduleTemplates.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Update `scheduleTemplateSchemas.ts`**

  Add the import and shared optional field, then thread it through all three
  variants:

  ```ts
  import { overdueAfterUnitSchema, startTimeSchema, weekdaySchema } from './scheduleSchemas.js';
  import { idParam } from './householdSchemas.js';

  const scheduleTemplateNameSchema = z.string().trim().min(1).max(60);

  const overdueAfterSchema = z
    .object({
      amount: z.number().int().min(1).max(999),
      unit: overdueAfterUnitSchema,
    })
    .optional();

  const everyNDaysScheduleTemplateSchema = z.object({
    recurrenceType: z.literal('every_n_days'),
    name: scheduleTemplateNameSchema,
    startTime: startTimeSchema,
    intervalDays: z.number().int().min(1).max(365),
    overdueAfter: overdueAfterSchema,
  });

  const weeklyScheduleTemplateSchema = z.object({
    recurrenceType: z.literal('weekly'),
    name: scheduleTemplateNameSchema,
    startTime: startTimeSchema,
    intervalWeeks: z.number().int().min(1).max(52),
    weekdays: z.array(weekdaySchema).min(1).max(7),
    overdueAfter: overdueAfterSchema,
  });

  const monthlyScheduleTemplateSchema = z.object({
    recurrenceType: z.literal('monthly'),
    name: scheduleTemplateNameSchema,
    startTime: startTimeSchema,
    intervalMonths: z.number().int().min(1).max(24),
    dayOfMonth: z.number().int().min(1).max(31),
    overdueAfter: overdueAfterSchema,
  });
  ```

  (The rest of the file — `createScheduleTemplateSchema`, `scheduleTemplateParamsSchema`
  — is unchanged.)

- [ ] **Step 4: Update `scheduleTemplateService.ts`**

  Update the `ScheduleTemplate` interface:

  ```ts
  export interface ScheduleTemplate {
    id: number;
    name: string;
    recurrenceType: ScheduleTemplateRecurrenceType;
    startTime: string;
    intervalDays: number | null;
    intervalWeeks: number | null;
    weekdays: number[] | null;
    intervalMonths: number | null;
    dayOfMonth: number | null;
    overdueAfter: { amount: number; unit: OverdueAfterUnit } | null;
  }
  ```

  Add the import:

  ```ts
  import type { OverdueAfterUnit } from './scheduleTime.js';
  ```

  Update `toSummary`:

  ```ts
  function toSummary(row: ScheduleTemplateRow): ScheduleTemplate {
    return {
      id: row.id,
      name: row.name,
      recurrenceType: row.recurrenceType,
      startTime: row.startTime,
      intervalDays: row.intervalDays,
      intervalWeeks: row.intervalWeeks,
      weekdays: row.weekdays ? (JSON.parse(row.weekdays) as number[]) : null,
      intervalMonths: row.intervalMonths,
      dayOfMonth: row.dayOfMonth,
      overdueAfter:
        row.overdueAfterAmount !== null && row.overdueAfterUnit !== null
          ? { amount: row.overdueAfterAmount, unit: row.overdueAfterUnit }
          : null,
    };
  }
  ```

  Update `createScheduleTemplate`'s insert to persist the new fields:

  ```ts
  export function createScheduleTemplate(
    householdId: number,
    requestingUserId: number,
    input: CreateScheduleTemplateInput,
  ): ScheduleTemplate {
    requireHeadMembership(householdId, requestingUserId);

    const values = buildRowValues(input);
    const row = db
      .insert(scheduleTemplates)
      .values({
        householdId,
        name: input.name,
        startTime: input.startTime,
        ...values,
        overdueAfterAmount: input.overdueAfter?.amount ?? null,
        overdueAfterUnit: input.overdueAfter?.unit ?? null,
        createdAt: Date.now(),
      })
      .returning()
      .get();

    return toSummary(row);
  }
  ```

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `cd backend && npx vitest run scheduleTemplates.test.ts`
  Expected: PASS.

- [ ] **Step 6: Typecheck, lint, full suite, commit**

  ```bash
  cd backend && npm run typecheck && npm run lint && npm test
  git add src/validation/scheduleTemplateSchemas.ts src/services/scheduleTemplateService.ts src/routes/scheduleTemplates.test.ts
  git commit -m "Adds optional overdue timer to schedule templates"
  ```

  This completes the backend. Everything below is frontend-only.

---

### Task 8: Frontend types and the `ChoreScheduleForm`/`ChoreScheduleControl` UI

**Files:**
- Modify: `frontend/src/types/schedule.ts`
- Modify: `frontend/src/types/scheduleTemplate.ts`
- Create: `frontend/src/utils/overdueAfterLabel.ts`
- Modify: `frontend/src/components/household/ChoreScheduleForm.tsx`
- Modify: `frontend/src/components/household/ChoreScheduleControl.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces: `OverdueAfterUnit` type, `formatOverdueAfter(...)` util — consumed by
  Task 9.

- [ ] **Step 1: Update `frontend/src/types/schedule.ts`**

  ```ts
  export type RecurrenceType = 'once' | 'every_n_days' | 'weekly' | 'monthly';
  export type OverdueAfterUnit = 'minutes' | 'hours' | 'days';

  export interface Schedule {
    recurrenceType: RecurrenceType;
    startDate: string; // YYYY-MM-DD, in the household's own timezone
    startTime: string; // HH:MM
    intervalDays: number | null;
    intervalWeeks: number | null;
    weekdays: number[] | null; // 0 (Sunday) - 6 (Saturday)
    intervalMonths: number | null;
    overdueAfter: { amount: number; unit: OverdueAfterUnit } | null;
    nextRunAt: number | null;
  }

  export interface ScheduleWithTarget extends Schedule {
    choreId: number;
    zoneId: number | null;
  }

  export type ScheduleInput =
    | { recurrenceType: 'once'; startDate: string; startTime: string; overdueAfter?: { amount: number; unit: OverdueAfterUnit } }
    | {
        recurrenceType: 'every_n_days';
        startDate: string;
        startTime: string;
        intervalDays: number;
        overdueAfter?: { amount: number; unit: OverdueAfterUnit };
      }
    | {
        recurrenceType: 'weekly';
        startDate: string;
        startTime: string;
        intervalWeeks: number;
        weekdays: number[];
        overdueAfter?: { amount: number; unit: OverdueAfterUnit };
      }
    | {
        recurrenceType: 'monthly';
        startDate: string;
        startTime: string;
        intervalMonths: number;
        overdueAfter?: { amount: number; unit: OverdueAfterUnit };
      };
  ```

- [ ] **Step 2: Update `frontend/src/types/scheduleTemplate.ts`**

  ```ts
  import type { OverdueAfterUnit } from './schedule';

  export type ScheduleTemplateRecurrenceType = 'every_n_days' | 'weekly' | 'monthly';

  export interface ScheduleTemplate {
    id: number;
    name: string;
    recurrenceType: ScheduleTemplateRecurrenceType;
    startTime: string; // HH:MM
    intervalDays: number | null;
    intervalWeeks: number | null;
    weekdays: number[] | null; // 0 (Sunday) - 6 (Saturday)
    intervalMonths: number | null;
    dayOfMonth: number | null;
    overdueAfter: { amount: number; unit: OverdueAfterUnit } | null;
  }

  export type CreateScheduleTemplateInput =
    | {
        recurrenceType: 'every_n_days';
        name: string;
        startTime: string;
        intervalDays: number;
        overdueAfter?: { amount: number; unit: OverdueAfterUnit };
      }
    | {
        recurrenceType: 'weekly';
        name: string;
        startTime: string;
        intervalWeeks: number;
        weekdays: number[];
        overdueAfter?: { amount: number; unit: OverdueAfterUnit };
      }
    | {
        recurrenceType: 'monthly';
        name: string;
        startTime: string;
        intervalMonths: number;
        dayOfMonth: number;
        overdueAfter?: { amount: number; unit: OverdueAfterUnit };
      };
  ```

- [ ] **Step 3: Create `frontend/src/utils/overdueAfterLabel.ts`**

  ```ts
  import type { OverdueAfterUnit } from '../types/schedule';

  export function formatOverdueAfter(
    overdueAfter: { amount: number; unit: OverdueAfterUnit } | null,
  ): string {
    if (!overdueAfter) return '';
    const unitLabel = overdueAfter.amount === 1 ? overdueAfter.unit.slice(0, -1) : overdueAfter.unit;
    return `Overdue after ${overdueAfter.amount} ${unitLabel}`;
  }
  ```

- [ ] **Step 4: Update `ChoreScheduleForm.tsx`**

  Add the import:

  ```ts
  import type { OverdueAfterUnit, RecurrenceType, Schedule, ScheduleInput } from '../../types/schedule';
  ```

  (Replace the existing `import type { RecurrenceType, Schedule, ScheduleInput }...`
  line.)

  Add state, right after the existing `scheduleTemplateName` state line:

  ```ts
  const [overdueAfterAmount, setOverdueAfterAmount] = useState(
    schedule?.overdueAfter ? String(schedule.overdueAfter.amount) : '',
  );
  const [overdueAfterUnit, setOverdueAfterUnit] = useState<OverdueAfterUnit>(
    schedule?.overdueAfter?.unit ?? 'hours',
  );
  ```

  Add a helper right after `toggleWeekday`:

  ```ts
  // Empty amount means "no timer" — mirrors how the rest of this form already
  // treats an empty field as not-configured (see buildScheduleInput's `!startDate`
  // early return).
  function buildOverdueAfter(): { amount: number; unit: OverdueAfterUnit } | undefined {
    const trimmed = overdueAfterAmount.trim();
    if (!trimmed) return undefined;
    const amount = Number(trimmed);
    if (!Number.isInteger(amount) || amount < 1) return undefined;
    return { amount, unit: overdueAfterUnit };
  }
  ```

  Update `applyScheduleTemplate` to also pre-fill the timer:

  ```ts
  function applyScheduleTemplate(scheduleTemplateId: string) {
    const template = scheduleTemplates.find((candidate) => String(candidate.id) === scheduleTemplateId);
    if (!template) return;

    setRecurrenceType(template.recurrenceType);
    setStartTime(template.startTime);
    if (template.intervalDays !== null) setIntervalDays(template.intervalDays);
    if (template.intervalWeeks !== null) setIntervalWeeks(template.intervalWeeks);
    if (template.weekdays !== null) setWeekdays(new Set(template.weekdays));
    if (template.intervalMonths !== null) setIntervalMonths(template.intervalMonths);
    if (template.overdueAfter) {
      setOverdueAfterAmount(String(template.overdueAfter.amount));
      setOverdueAfterUnit(template.overdueAfter.unit);
    } else {
      setOverdueAfterAmount('');
    }
    setStartDate(suggestStartDate(template));
  }
  ```

  Update `buildScheduleTemplateInput` to include it in every branch:

  ```ts
  function buildScheduleTemplateInput(name: string): CreateScheduleTemplateInput | null {
    const overdueAfter = buildOverdueAfter();
    switch (recurrenceType) {
      case 'every_n_days':
        return { recurrenceType, name, startTime, intervalDays, overdueAfter };
      case 'weekly':
        return { recurrenceType, name, startTime, intervalWeeks, weekdays: [...weekdays], overdueAfter };
      case 'monthly':
        return {
          recurrenceType,
          name,
          startTime,
          intervalMonths,
          dayOfMonth: Number(startDate.split('-')[2]),
          overdueAfter,
        };
      case 'once':
        return null;
    }
  }
  ```

  Update `buildScheduleInput` to include it in every branch:

  ```ts
  function buildScheduleInput(): ScheduleInput | undefined {
    if (!startDate) return undefined;
    const overdueAfter = buildOverdueAfter();

    switch (recurrenceType) {
      case 'once':
        return { recurrenceType, startDate, startTime, overdueAfter };
      case 'every_n_days':
        return { recurrenceType, startDate, startTime, intervalDays, overdueAfter };
      case 'weekly':
        if (weekdays.size === 0) return undefined;
        return { recurrenceType, startDate, startTime, intervalWeeks, weekdays: [...weekdays], overdueAfter };
      case 'monthly':
        return { recurrenceType, startDate, startTime, intervalMonths, overdueAfter };
    }
  }
  ```

  Add the new field group in the JSX, right after the existing `<FormField label="At" .../>` line and before the `{recurrenceType !== 'once' && (...)}` save-as-template block:

  ```tsx
      <label className="schedule-field">
        Become overdue if still to-do after
        <div className="overdue-after-inputs">
          <input
            type="number"
            min={1}
            max={999}
            placeholder="No timer"
            value={overdueAfterAmount}
            onChange={(event) => setOverdueAfterAmount(event.target.value)}
          />
          <select
            value={overdueAfterUnit}
            onChange={(event) => setOverdueAfterUnit(event.target.value as OverdueAfterUnit)}
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
      </label>
  ```

- [ ] **Step 5: Update `ChoreScheduleControl.tsx`**

  Add the import:

  ```ts
  import { formatOverdueAfter } from '../../utils/overdueAfterLabel';
  ```

  Update the pill rendering — replace the single
  `{RECURRENCE_SUMMARY[schedule.recurrenceType](schedule)}` expression inside
  `.chore-schedule-pill` with a composed summary. In the non-editing `return`
  block, right before the `return (` for the pill/button JSX, add:

  ```ts
  const summaryText = schedule
    ? (() => {
        const base = RECURRENCE_SUMMARY[schedule.recurrenceType](schedule);
        const overdueSuffix = formatOverdueAfter(schedule.overdueAfter);
        return overdueSuffix ? `${base} · ${overdueSuffix}` : base;
      })()
    : '';
  ```

  Then change the pill's content:

  ```tsx
          <span className="chore-schedule-pill">
            {summaryText}
  ```

  (leave everything else — the `chip-remove` button inside the pill, the "No
  schedule" branch, the add/edit button — unchanged).

- [ ] **Step 6: Add CSS for the side-by-side amount+unit inputs**

  Add to `frontend/src/index.css`, right after the existing `.schedule-field select,
  .schedule-field input { ... }` rule:

  ```css
  .overdue-after-inputs {
    display: flex;
    gap: 8px;
  }

  .overdue-after-inputs input {
    flex: 1;
    min-width: 0;
  }
  ```

- [ ] **Step 7: Typecheck and lint**

  ```bash
  cd frontend && npm run typecheck && npm run lint
  ```

  Expected: passes. `BulkScheduleBar.tsx` and every other consumer of `Schedule`/
  `ScheduleInput` compiles unchanged, since `overdueAfter` is optional on the input
  side and always present (possibly `null`) on the read side, and no other file
  destructures these types exhaustively in a way that would now be missing a case.

- [ ] **Step 8: Commit**

  ```bash
  git add frontend/src/types/schedule.ts frontend/src/types/scheduleTemplate.ts \
    frontend/src/utils/overdueAfterLabel.ts \
    frontend/src/components/household/ChoreScheduleForm.tsx \
    frontend/src/components/household/ChoreScheduleControl.tsx \
    frontend/src/index.css
  git commit -m "Adds overdue-timer field to the schedule form and pill summary"
  ```

---

### Task 9: `ScheduleTemplateForm.tsx` and `SchedulesPage.tsx`

**Files:**
- Modify: `frontend/src/components/household/ScheduleTemplateForm.tsx`
- Modify: `frontend/src/pages/SchedulesPage.tsx`

**Interfaces:**
- Consumes: `OverdueAfterUnit` (Task 8), `formatOverdueAfter` (Task 8).

- [ ] **Step 1: Update `ScheduleTemplateForm.tsx`**

  Add the import:

  ```ts
  import type { CreateScheduleTemplateInput, ScheduleTemplateRecurrenceType } from '../../types/scheduleTemplate';
  import type { OverdueAfterUnit } from '../../types/schedule';
  ```

  Add state, after the existing `dayOfMonth` state line:

  ```ts
  const [overdueAfterAmount, setOverdueAfterAmount] = useState('');
  const [overdueAfterUnit, setOverdueAfterUnit] = useState<OverdueAfterUnit>('hours');
  ```

  Add the same helper used in `ChoreScheduleForm.tsx`, after `toggleWeekday`:

  ```ts
  function buildOverdueAfter(): { amount: number; unit: OverdueAfterUnit } | undefined {
    const trimmed = overdueAfterAmount.trim();
    if (!trimmed) return undefined;
    const amount = Number(trimmed);
    if (!Number.isInteger(amount) || amount < 1) return undefined;
    return { amount, unit: overdueAfterUnit };
  }
  ```

  Update `handleSubmit` to include it in every branch:

  ```ts
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const overdueAfter = buildOverdueAfter();

    switch (recurrenceType) {
      case 'every_n_days':
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalDays, overdueAfter });
        break;
      case 'weekly':
        if (weekdays.size === 0) return;
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalWeeks, weekdays: [...weekdays], overdueAfter });
        break;
      case 'monthly':
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalMonths, dayOfMonth, overdueAfter });
        break;
    }

    setName('');
  }
  ```

  Add the field group in the JSX, right after the existing `<FormField label="At"
  .../>` line (the last field before the submit button):

  ```tsx
      <label className="schedule-field">
        Become overdue if still to-do after
        <div className="overdue-after-inputs">
          <input
            type="number"
            min={1}
            max={999}
            placeholder="No timer"
            value={overdueAfterAmount}
            onChange={(event) => setOverdueAfterAmount(event.target.value)}
          />
          <select
            value={overdueAfterUnit}
            onChange={(event) => setOverdueAfterUnit(event.target.value as OverdueAfterUnit)}
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
      </label>
  ```

- [ ] **Step 2: Update `SchedulesPage.tsx`**

  Add the import:

  ```ts
  import { formatOverdueAfter } from '../utils/overdueAfterLabel';
  ```

  Update the rendering of each template's summary line — replace:

  ```tsx
                <div className="chore-schedule-control">
                  <span className="chore-schedule-summary">
                    {RECURRENCE_LABEL[template.recurrenceType](template)}
                  </span>
                </div>
  ```

  with:

  ```tsx
                <div className="chore-schedule-control">
                  <span className="chore-schedule-summary">
                    {(() => {
                      const base = RECURRENCE_LABEL[template.recurrenceType](template);
                      const overdueSuffix = formatOverdueAfter(template.overdueAfter);
                      return overdueSuffix ? `${base} · ${overdueSuffix}` : base;
                    })()}
                  </span>
                </div>
  ```

- [ ] **Step 3: Typecheck and lint**

  ```bash
  cd frontend && npm run typecheck && npm run lint
  ```

  Expected: passes.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/household/ScheduleTemplateForm.tsx frontend/src/pages/SchedulesPage.tsx
  git commit -m "Adds overdue timer to the schedule template form and summary"
  ```

---

### Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full backend check**

  ```bash
  cd backend && npm run typecheck && npm run lint && npm test
  ```

  Expected: all green. Tolerate and re-run once if the pre-existing, unrelated
  `Parse Error: Expected HTTP/, RTSP/ or ICE/` flake appears (documented test-runner
  flakiness noted earlier in this project's history, not a regression from this
  work).

- [ ] **Step 2: Full frontend check**

  ```bash
  cd frontend && npm run typecheck && npm run lint
  ```

  Expected: all green.

- [ ] **Step 3: Manual verification via `dev:ai`**

  Per CLAUDE.md, use `npm run dev:ai` only (never `npm run dev`), and shut it down
  afterward by port-derived PID tree (never `pkill -f`). From the repo root:

  ```bash
  nohup npm run dev:ai > /tmp/dev-ai.log 2>&1 &
  ```

  Then, via browser automation against `http://localhost:4173`:
  1. Log in (or register a fresh test account/household).
  2. Create a chore, open its schedule form, confirm the new "Become overdue if
     still to-do after" number+unit fields render, leave it blank, save a schedule,
     confirm the pill shows no "Overdue after" suffix.
  3. Edit that schedule again, set "2" + "minutes", save, confirm the pill now
     reads "... · Overdue after 2 minutes".
  4. Wait ~2+ minutes (or directly `POST`/inspect via the AI-only DB to fast-forward
     — e.g. update the row's `overdue_at` to the past via a scratch script — rather
     than actually waiting, to keep this fast) and confirm the chore flips to
     `overdue` on its own within the next 60-second poll tick, and that reloading
     the page shows the `overdue` badge.
  5. Repeat step 2-4 for a zoned chore's zone-level schedule.
  6. Create a schedule template with an overdue timer on `/schedules/new`, confirm
     it appears on `/schedules` with the "Overdue after ..." suffix, then apply it
     from a chore's schedule form and confirm the timer fields pre-fill correctly.
  7. Clean up any test chores/zones/templates created, via direct API `fetch()`
     calls (established pattern this session) or the UI's own remove actions.
  8. Shut down `dev:ai` by port-derived PID tree:
     ```bash
     ps -eo pid,ppid,command | grep -E "dev:ai|concurrently|tsx watch|vite" | grep -v grep
     ```
     then `kill` every PID in that specific tree (never `pkill -f`).

- [ ] **Step 4: Report completion**

  Summarize what was verified and any deviations from this plan encountered during
  implementation.
