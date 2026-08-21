# Schedule Patterns + Bulk-Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Head of Household save named, reusable recurrence shapes ("schedule patterns") and apply one to instantly fill in a chore/zone's schedule form, and let them apply one schedule configuration to many chores/zones at once via a "select chores" bulk-apply mode — both aimed at cutting the repeated manual setup phase 1 left in place.

**Architecture:** A new, deliberately simple `schedule_patterns` table (household-scoped, no target, no clock-facing fields at all — patterns are never evaluated by `choreScheduler.ts`) with its own CRUD service/routes, mirroring the exact conventions `chore_schedules`/`scheduleService.ts`/`chores.ts` already established. The frontend adds a pattern picker + "save as pattern" action inside the existing `ChoreScheduleForm`, and a "select chores" bulk mode on the chores list that reuses the *existing* single-target schedule endpoints (one call per selected target, via `Promise.allSettled`) rather than adding a new batch endpoint.

**Tech Stack:** Same as the rest of the app — Node/TS/Express/Drizzle-SQLite backend, React/TS frontend. No new dependencies.

## Global Constraints

- Backend: run `npm run typecheck`, `npm run lint`, and `npm test` in `backend/` before considering any task done.
- Frontend: run `npm run typecheck` and `npm run lint` in `frontend/` (no frontend test suite exists in this project — don't add one).
- Never run `npm run dev` yourself; use `npm run dev:ai` for manual verification, and stop it by port per `CLAUDE.md`.
- No comments except why-comments, matching the rest of the codebase.
- No new npm dependencies.
- Head of Household only for creating/renaming/removing a pattern; any member can view — same split already used for schedules/chores/zones.
- Patterns use **snapshot semantics** — applying one just pre-fills a form; there is no FK from `chore_schedules` to `schedule_patterns` anywhere, and none should be added.
- Bulk-apply is pure frontend orchestration over the *existing* `PUT .../schedule` endpoints — no new backend batch endpoint.

---

## Task 1: Schema and migration — `schedule_patterns` table

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/drizzle/00XX_<generated-name>.sql` (via `db:generate`)

**Interfaces:**
- Produces: `PATTERN_RECURRENCE_TYPES` / `PatternRecurrenceType`, `schedulePatterns` table export — every later backend task depends on these.

- [ ] **Step 1: Add the table and its type**

In `backend/src/db/schema.ts`, add after the `choreSchedules` table definition:

```typescript
export const PATTERN_RECURRENCE_TYPES = ['every_n_days', 'weekly', 'monthly'] as const;
export type PatternRecurrenceType = (typeof PATTERN_RECURRENCE_TYPES)[number];

// Household-scoped, reusable recurrence shapes a head can apply to a chore/zone's
// schedule via a picker (see patternService.ts) — snapshot semantics: applying one
// just pre-fills the schedule form. There is no FK from chore_schedules back here,
// so editing/deleting a pattern never touches a schedule that already used it.
// Deliberately excludes 'once' from its own recurrence-type enum (rather than
// reusing RECURRENCE_TYPES) — a one-off date isn't reusable as a named pattern.
// No startAt/target/nextRunAt like chore_schedules — a pattern is never itself
// evaluated by choreScheduler.ts, so startTime is plain 'HH:MM' text rather than an
// epoch instant, and monthly's dayOfMonth is a first-class input here (unlike
// chore_schedules, which derives it from startDate — a pattern has no date to derive
// it from).
export const schedulePatterns = sqliteTable('schedule_patterns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  householdId: integer('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  recurrenceType: text('recurrence_type', { enum: PATTERN_RECURRENCE_TYPES }).notNull(),
  startTime: text('start_time').notNull(),
  intervalDays: integer('interval_days'),
  intervalWeeks: integer('interval_weeks'),
  weekdays: text('weekdays'),
  intervalMonths: integer('interval_months'),
  dayOfMonth: integer('day_of_month'),
  createdAt: integer('created_at').notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `cd backend && npm run db:generate`

Confirm the generated `.sql` contains `CREATE TABLE \`schedule_patterns\`` with a foreign key to `households` (cascade). No `CHECK` constraint is needed here (unlike `chore_schedules`) — there's no "exactly one of two nullable columns" invariant to enforce, just a plain nullable-per-recurrence-type shape, same as the rest of this table's siblings.

- [ ] **Step 3: Verify against a scratch copy of the real database**

Run (from `backend/`):
```bash
cp data/chore-tracker.db /tmp/chore-tracker-scratch.db 2>/dev/null || echo "no existing db — skipping scratch-copy check"
DB_FILE=/tmp/chore-tracker-scratch.db npx tsx -e "import('./src/db/client.js').then(m => m.runMigrations())"
```
Expected: no error. This migration only adds a new table with a simple FK — it doesn't recreate an existing table, so it isn't expected to hit the class of bug `CLAUDE.md` documents for migration `0009`; this is a sanity check, not expected to find anything.

- [ ] **Step 4: Run the existing migration test, typecheck, commit**

Run: `cd backend && npx vitest run src/db/migrations.test.ts && npm run typecheck`
Expected: both PASS (the migration test uses `expect.arrayContaining`, so a new table doesn't break it).

```bash
git add backend/src/db/schema.ts backend/drizzle/
git commit -m "feat: add schedule_patterns table"
```

---

## Task 2: Validation — `patternSchemas.ts`

**Files:**
- Modify: `backend/src/validation/scheduleSchemas.ts`
- Create: `backend/src/validation/patternSchemas.ts`

**Interfaces:**
- Consumes: `startTimeSchema`/`weekdaySchema` (widened to exported), `idParam` from `backend/src/validation/householdSchemas.ts`.
- Produces: `createPatternSchema`/`CreatePatternInput`, `renamePatternSchema`/`RenamePatternInput`, `patternParamsSchema` — consumed by Task 3 (service) and Task 4 (routes).

- [ ] **Step 1: Export the two schemas `patternSchemas.ts` needs to reuse**

In `backend/src/validation/scheduleSchemas.ts`, change:

```typescript
const startTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
const weekdaySchema = z.number().int().min(0).max(6);
```

to:

```typescript
export const startTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export const weekdaySchema = z.number().int().min(0).max(6);
```

No other change to this file — everything else that already references these two names locally keeps working unchanged.

- [ ] **Step 2: Write `patternSchemas.ts`**

Create `backend/src/validation/patternSchemas.ts`:

```typescript
import { z } from 'zod';
import { startTimeSchema, weekdaySchema } from './scheduleSchemas.js';
import { idParam } from './householdSchemas.js';

const patternNameSchema = z.string().trim().min(1).max(60);

const everyNDaysPatternSchema = z.object({
  recurrenceType: z.literal('every_n_days'),
  name: patternNameSchema,
  startTime: startTimeSchema,
  intervalDays: z.number().int().min(1).max(365),
});

const weeklyPatternSchema = z.object({
  recurrenceType: z.literal('weekly'),
  name: patternNameSchema,
  startTime: startTimeSchema,
  intervalWeeks: z.number().int().min(1).max(52),
  weekdays: z.array(weekdaySchema).min(1).max(7),
});

// dayOfMonth is a required client-supplied field here — unlike setScheduleSchema's
// monthly variant, a pattern has no startDate to derive it from (see schema.ts's
// comment on schedulePatterns).
const monthlyPatternSchema = z.object({
  recurrenceType: z.literal('monthly'),
  name: patternNameSchema,
  startTime: startTimeSchema,
  intervalMonths: z.number().int().min(1).max(24),
  dayOfMonth: z.number().int().min(1).max(31),
});

export const createPatternSchema = z.discriminatedUnion('recurrenceType', [
  everyNDaysPatternSchema,
  weeklyPatternSchema,
  monthlyPatternSchema,
]);

export type CreatePatternInput = z.infer<typeof createPatternSchema>;

export const renamePatternSchema = z.object({
  name: patternNameSchema,
});

export type RenamePatternInput = z.infer<typeof renamePatternSchema>;

export const patternParamsSchema = z.object({
  householdId: idParam,
  patternId: idParam,
});
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd backend && npm run typecheck`
Expected: PASS.

```bash
git add backend/src/validation/scheduleSchemas.ts backend/src/validation/patternSchemas.ts
git commit -m "feat: add request validation for schedule patterns"
```

---

## Task 3: `patternService.ts` — CRUD and authorization

**Files:**
- Modify: `backend/src/errors.ts`
- Create: `backend/src/services/patternService.ts`

**Interfaces:**
- Consumes: `requireHeadMembership`/`requireMembership` from `./membershipAuth.js`; `CreatePatternInput`/`RenamePatternInput` from `../validation/patternSchemas.js`.
- Produces: `SchedulePattern` interface, `listPatternsForHousehold`, `createPattern`, `renamePattern`, `removePattern` — consumed by Task 4's routes.

No dedicated test file — like `scheduleService.ts`, every function here has an HTTP entry point and is exercised entirely through Task 4's route tests.

- [ ] **Step 1: Add `PatternNotFoundError`**

Add to `backend/src/errors.ts`, after `ChoreScheduleManagedByZonesError`:

```typescript
export class PatternNotFoundError extends AppError {
  constructor() {
    super(404, 'PatternNotFound', 'That schedule pattern was not found');
  }
}
```

- [ ] **Step 2: Write `patternService.ts`**

Create `backend/src/services/patternService.ts`:

```typescript
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { schedulePatterns } from '../db/schema.js';
import type { PatternRecurrenceType } from '../db/schema.js';
import { PatternNotFoundError } from '../errors.js';
import { requireHeadMembership, requireMembership } from './membershipAuth.js';
import type { CreatePatternInput, RenamePatternInput } from '../validation/patternSchemas.js';

export interface SchedulePattern {
  id: number;
  name: string;
  recurrenceType: PatternRecurrenceType;
  startTime: string;
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null;
  intervalMonths: number | null;
  dayOfMonth: number | null;
}

type PatternRow = typeof schedulePatterns.$inferSelect;

function toSummary(row: PatternRow): SchedulePattern {
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
  };
}

// Mirrors scheduleService.ts's buildRowValues — one recurrence-shaped column set per
// type, everything else null.
function buildRowValues(input: CreatePatternInput) {
  switch (input.recurrenceType) {
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
        dayOfMonth: input.dayOfMonth,
      };
  }
}

function findPatternInHousehold(householdId: number, patternId: number): PatternRow | undefined {
  return db
    .select()
    .from(schedulePatterns)
    .where(and(eq(schedulePatterns.id, patternId), eq(schedulePatterns.householdId, householdId)))
    .get();
}

export function listPatternsForHousehold(
  householdId: number,
  requestingUserId: number,
): SchedulePattern[] {
  requireMembership(householdId, requestingUserId);
  return db
    .select()
    .from(schedulePatterns)
    .where(eq(schedulePatterns.householdId, householdId))
    .all()
    .map(toSummary);
}

export function createPattern(
  householdId: number,
  requestingUserId: number,
  input: CreatePatternInput,
): SchedulePattern {
  requireHeadMembership(householdId, requestingUserId);

  const values = buildRowValues(input);
  const row = db
    .insert(schedulePatterns)
    .values({
      householdId,
      name: input.name,
      startTime: input.startTime,
      ...values,
      createdAt: Date.now(),
    })
    .returning()
    .get();

  return toSummary(row);
}

export function renamePattern(
  householdId: number,
  requestingUserId: number,
  patternId: number,
  input: RenamePatternInput,
): SchedulePattern {
  requireHeadMembership(householdId, requestingUserId);

  if (!findPatternInHousehold(householdId, patternId)) throw new PatternNotFoundError();

  const row = db
    .update(schedulePatterns)
    .set({ name: input.name })
    .where(eq(schedulePatterns.id, patternId))
    .returning()
    .get();

  return toSummary(row);
}

export function removePattern(
  householdId: number,
  requestingUserId: number,
  patternId: number,
): void {
  requireHeadMembership(householdId, requestingUserId);

  if (!findPatternInHousehold(householdId, patternId)) throw new PatternNotFoundError();

  db.delete(schedulePatterns).where(eq(schedulePatterns.id, patternId)).run();
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd backend && npm run typecheck`
Expected: PASS.

```bash
git add backend/src/errors.ts backend/src/services/patternService.ts
git commit -m "feat: add patternService for schedule pattern CRUD"
```

---

## Task 4: Pattern routes

**Files:**
- Create: `backend/src/routes/patterns.ts`
- Create: `backend/src/routes/patterns.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: everything produced by Task 2 and Task 3.

- [ ] **Step 1: Write failing route tests**

Create `backend/src/routes/patterns.test.ts`:

```typescript
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

const testDir = mkdtempSync(join(tmpdir(), 'chore-tracker-patterns-routes-'));
process.env.DB_FILE = join(testDir, 'test.db');
process.env.SESSION_TTL_DAYS = '30';
process.env.CORS_ORIGIN = 'http://localhost:5173';

const { runMigrations, sqlite } = await import('../db/client.js');
const { createApp } = await import('../app.js');

runMigrations();
const app = createApp();

afterAll(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

function cookieFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!cookie) throw new Error('Expected a session cookie to be set');
  return cookie;
}

async function registerHeadOfHousehold(email: string, householdName: string) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      username: email.split('@')[0],
      password: 'correct-horse-battery',
      household: { mode: 'create', name: householdName },
    });
  return {
    cookie: cookieFrom(response),
    householdId: response.body.households[0].id as number,
    joinCode: response.body.households[0].joinCode as string,
  };
}

async function registerAndJoin(
  email: string,
  head: Awaited<ReturnType<typeof registerHeadOfHousehold>>,
) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      username: email.split('@')[0],
      password: 'correct-horse-battery',
      household: { mode: 'join', joinCode: head.joinCode },
    });
  const cookie = cookieFrom(response);
  const userId = response.body.user.id as number;
  await request(app)
    .post(`/api/households/${head.householdId}/members/${userId}/approve`)
    .set('Cookie', head.cookie);
  return { cookie, userId };
}

describe('schedule patterns', () => {
  it('lets the head create a pattern and lists it back', async () => {
    const head = await registerHeadOfHousehold('pattern-hoh@example.com', 'Pattern House');

    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'every_n_days',
        name: 'Daily evenings',
        startTime: '18:00',
        intervalDays: 1,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.pattern).toEqual({
      id: expect.any(Number),
      name: 'Daily evenings',
      recurrenceType: 'every_n_days',
      startTime: '18:00',
      intervalDays: 1,
      intervalWeeks: null,
      weekdays: null,
      intervalMonths: null,
      dayOfMonth: null,
    });

    const listResponse = await request(app)
      .get(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.patterns).toEqual([createResponse.body.pattern]);
  });

  it('creates a weekly pattern with the given weekdays', async () => {
    const head = await registerHeadOfHousehold('pattern-weekly-hoh@example.com', 'Weekly Pattern House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'weekly',
        name: 'Weekday mornings',
        startTime: '08:00',
        intervalWeeks: 1,
        weekdays: [1, 3, 5],
      });

    expect(response.status).toBe(201);
    expect(response.body.pattern.weekdays).toEqual([1, 3, 5]);
  });

  it('creates a monthly pattern with an explicit day of month', async () => {
    const head = await registerHeadOfHousehold('pattern-monthly-hoh@example.com', 'Monthly Pattern House');

    const response = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({
        recurrenceType: 'monthly',
        name: 'Monthly reset',
        startTime: '09:00',
        intervalMonths: 1,
        dayOfMonth: 1,
      });

    expect(response.status).toBe(201);
    expect(response.body.pattern.dayOfMonth).toBe(1);
  });

  it('rejects a non-head member with 403', async () => {
    const head = await registerHeadOfHousehold('pattern-member-hoh@example.com', 'Member Pattern House');
    const member = await registerAndJoin('pattern-member@example.com', head);

    const response = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', member.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Not yours', startTime: '09:00', intervalDays: 1 });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('NotHeadOfHousehold');
  });

  it('lets any member list patterns', async () => {
    const head = await registerHeadOfHousehold('pattern-list-hoh@example.com', 'List Pattern House');
    const member = await registerAndJoin('pattern-list-member@example.com', head);
    await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Shared pattern', startTime: '09:00', intervalDays: 1 });

    const response = await request(app)
      .get(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', member.cookie);

    expect(response.status).toBe(200);
    expect(response.body.patterns).toHaveLength(1);
  });

  it('renames a pattern', async () => {
    const head = await registerHeadOfHousehold('pattern-rename-hoh@example.com', 'Rename Pattern House');
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'Old name', startTime: '09:00', intervalDays: 1 });
    const patternId = createResponse.body.pattern.id;

    const renameResponse = await request(app)
      .patch(`/api/households/${head.householdId}/patterns/${patternId}`)
      .set('Cookie', head.cookie)
      .send({ name: 'New name' });

    expect(renameResponse.status).toBe(200);
    expect(renameResponse.body.pattern.name).toBe('New name');
  });

  it('404s renaming a pattern that does not exist', async () => {
    const head = await registerHeadOfHousehold('pattern-rename-404-hoh@example.com', 'Rename 404 House');

    const response = await request(app)
      .patch(`/api/households/${head.householdId}/patterns/999999`)
      .set('Cookie', head.cookie)
      .send({ name: 'New name' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('PatternNotFound');
  });

  it('removes a pattern', async () => {
    const head = await registerHeadOfHousehold('pattern-remove-hoh@example.com', 'Remove Pattern House');
    const createResponse = await request(app)
      .post(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie)
      .send({ recurrenceType: 'every_n_days', name: 'To remove', startTime: '09:00', intervalDays: 1 });
    const patternId = createResponse.body.pattern.id;

    const removeResponse = await request(app)
      .delete(`/api/households/${head.householdId}/patterns/${patternId}`)
      .set('Cookie', head.cookie);
    expect(removeResponse.status).toBe(204);

    const listResponse = await request(app)
      .get(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', head.cookie);
    expect(listResponse.body.patterns).toEqual([]);
  });

  it('rejects a non-member with a generic 404 when listing', async () => {
    const head = await registerHeadOfHousehold('pattern-outsider-hoh@example.com', 'Outsider Pattern House');
    const outsider = await registerHeadOfHousehold('pattern-outsider@example.com', 'Outsider Pattern House 2');

    const response = await request(app)
      .get(`/api/households/${head.householdId}/patterns`)
      .set('Cookie', outsider.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('HouseholdNotFound');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run src/routes/patterns.test.ts`
Expected: FAIL — nothing at `/api/households/:householdId/patterns` exists yet.

- [ ] **Step 3: Implement `patterns.ts`**

Create `backend/src/routes/patterns.ts`:

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { NotAuthenticatedError, ValidationError } from '../errors.js';
import { householdParamsSchema } from '../validation/householdSchemas.js';
import {
  createPatternSchema,
  patternParamsSchema,
  renamePatternSchema,
} from '../validation/patternSchemas.js';
import * as patternService from '../services/patternService.js';

export const patternsRouter = Router();

patternsRouter.use(requireAuth);

patternsRouter.get('/:householdId/patterns', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const parsed = householdParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    next(new ValidationError('Invalid household id', parsed.error.issues));
    return;
  }

  try {
    const patterns = patternService.listPatternsForHousehold(parsed.data.householdId, req.user.id);
    res.status(200).json({ patterns });
  } catch (err) {
    next(err);
  }
});

patternsRouter.post('/:householdId/patterns', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = householdParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid household id', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = createPatternSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid pattern', bodyParsed.error.issues));
    return;
  }

  try {
    const pattern = patternService.createPattern(
      paramsParsed.data.householdId,
      req.user.id,
      bodyParsed.data,
    );
    res.status(201).json({ pattern });
  } catch (err) {
    next(err);
  }
});

patternsRouter.patch('/:householdId/patterns/:patternId', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = patternParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid ids', paramsParsed.error.issues));
    return;
  }

  const bodyParsed = renamePatternSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    next(new ValidationError('Invalid name', bodyParsed.error.issues));
    return;
  }

  try {
    const pattern = patternService.renamePattern(
      paramsParsed.data.householdId,
      req.user.id,
      paramsParsed.data.patternId,
      bodyParsed.data,
    );
    res.status(200).json({ pattern });
  } catch (err) {
    next(err);
  }
});

patternsRouter.delete('/:householdId/patterns/:patternId', (req, res, next) => {
  if (!req.user) throw new NotAuthenticatedError();

  const paramsParsed = patternParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    next(new ValidationError('Invalid ids', paramsParsed.error.issues));
    return;
  }

  try {
    patternService.removePattern(
      paramsParsed.data.householdId,
      req.user.id,
      paramsParsed.data.patternId,
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Mount the router**

In `backend/src/app.ts`, add the import:

```typescript
import { patternsRouter } from './routes/patterns.js';
```

And add, alongside the other `app.use('/api/households', ...)` lines:

```typescript
app.use('/api/households', patternsRouter);
```

- [ ] **Step 5: Run to verify pass, then full backend verification, commit**

Run: `cd backend && npx vitest run src/routes/patterns.test.ts`
Expected: PASS.

Run: `cd backend && npm run typecheck && npm run lint && npm test`
Expected: all PASS.

```bash
git add backend/src/routes/patterns.ts backend/src/routes/patterns.test.ts backend/src/app.ts
git commit -m "feat: add schedule pattern routes"
```

---

## Task 5: Frontend — pattern types and API client

**Files:**
- Create: `frontend/src/types/pattern.ts`
- Create: `frontend/src/api/patternApi.ts`

**Interfaces:**
- Produces: `PatternRecurrenceType`, `SchedulePattern`, `CreatePatternInput`, `RenamePatternInput`; `listPatterns`, `createPattern`, `renamePattern`, `removePattern`.

- [ ] **Step 1: Add the types**

Create `frontend/src/types/pattern.ts`:

```typescript
export type PatternRecurrenceType = 'every_n_days' | 'weekly' | 'monthly';

export interface SchedulePattern {
  id: number;
  name: string;
  recurrenceType: PatternRecurrenceType;
  startTime: string; // HH:MM
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null; // 0 (Sunday) - 6 (Saturday)
  intervalMonths: number | null;
  dayOfMonth: number | null;
}

export type CreatePatternInput =
  | { recurrenceType: 'every_n_days'; name: string; startTime: string; intervalDays: number }
  | {
      recurrenceType: 'weekly';
      name: string;
      startTime: string;
      intervalWeeks: number;
      weekdays: number[];
    }
  | {
      recurrenceType: 'monthly';
      name: string;
      startTime: string;
      intervalMonths: number;
      dayOfMonth: number;
    };

export interface RenamePatternInput {
  name: string;
}
```

- [ ] **Step 2: Add the API client**

Create `frontend/src/api/patternApi.ts`:

```typescript
import { apiRequest } from './httpClient';
import type { CreatePatternInput, RenamePatternInput, SchedulePattern } from '../types/pattern';

export async function listPatterns(householdId: number): Promise<SchedulePattern[]> {
  const response = await apiRequest<{ patterns: SchedulePattern[] }>(
    `/api/households/${householdId}/patterns`,
  );
  return response.patterns;
}

export async function createPattern(
  householdId: number,
  input: CreatePatternInput,
): Promise<SchedulePattern> {
  const response = await apiRequest<{ pattern: SchedulePattern }>(
    `/api/households/${householdId}/patterns`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.pattern;
}

export async function renamePattern(
  householdId: number,
  patternId: number,
  input: RenamePatternInput,
): Promise<SchedulePattern> {
  const response = await apiRequest<{ pattern: SchedulePattern }>(
    `/api/households/${householdId}/patterns/${patternId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.pattern;
}

export async function removePattern(householdId: number, patternId: number): Promise<void> {
  await apiRequest<void>(`/api/households/${householdId}/patterns/${patternId}`, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

```bash
git add frontend/src/types/pattern.ts frontend/src/api/patternApi.ts
git commit -m "feat: add frontend types and API client for schedule patterns"
```

---

## Task 6: `suggestStartDate.ts` — pure date-suggestion helper

**Files:**
- Create: `frontend/src/utils/suggestStartDate.ts`

**Interfaces:**
- Consumes: `SchedulePattern` from `../types/pattern`.
- Produces: `suggestStartDate(pattern, today?): string` — consumed by Task 8's `ChoreScheduleForm.tsx`.

No test file — this project has no frontend test suite (see Global Constraints); verified by `npm run typecheck` here, and indirectly by manual verification in the final task.

- [ ] **Step 1: Write the helper**

Create `frontend/src/utils/suggestStartDate.ts`:

```typescript
import type { SchedulePattern } from '../types/pattern';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// month is 1-based here (1 = January) — new Date(year, month, 0) rolls back to day 0
// of the next 0-based month, i.e. the last real day of the 1-based `month`.
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// A suggestion only — the user can still change the date before saving. Uses the
// browser's own local calendar, not a server round-trip; this feature already
// accepts that browser-vs-household timezone can drift slightly (see
// HouseholdCard.tsx's timezone-sync comment), which is fine for a pre-fill.
export function suggestStartDate(pattern: SchedulePattern, today: Date = new Date()): string {
  switch (pattern.recurrenceType) {
    case 'every_n_days':
      return formatDate(today);

    case 'weekly': {
      const weekdays = new Set(pattern.weekdays ?? []);
      for (let offset = 0; offset < 7; offset++) {
        const candidate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
        if (weekdays.has(candidate.getDay())) return formatDate(candidate);
      }
      // Unreachable if the pattern has at least one weekday (always true once
      // created — see patternSchemas.ts's min(1) on weekdays), kept as a safe
      // fallback rather than throwing.
      return formatDate(today);
    }

    case 'monthly': {
      const day = pattern.dayOfMonth ?? 1;
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      // Deliberately does NOT clamp to a short month's last day the way
      // scheduleTime.ts's real monthly stepping does — clamping here would suggest
      // e.g. Feb 28 for a "31st of every month" pattern, and since the eventual
      // schedule's own dayOfMonth is derived from whatever date actually gets saved
      // (see ChoreScheduleForm.tsx's buildPatternInput / scheduleService.ts), a
      // clamped suggestion the user doesn't think to correct would permanently
      // downgrade the schedule to the 28th instead of the 31st. Searching forward to
      // the next month that actually has this day keeps the suggested date's
      // day-of-month exactly equal to the pattern's, always.
      for (let monthOffset = 0; monthOffset < 12; monthOffset++) {
        const monthIndex = today.getMonth() + monthOffset;
        const year = today.getFullYear() + Math.floor(monthIndex / 12);
        const zeroBasedMonth = monthIndex % 12;
        if (day > daysInMonth(year, zeroBasedMonth + 1)) continue;
        const candidate = new Date(year, zeroBasedMonth, day);
        if (candidate >= todayOnly) return formatDate(candidate);
      }
      // Unreachable for a valid dayOfMonth (1-31, enforced by patternSchemas.ts) —
      // within any 12 consecutive months there's always at least one match. Kept as
      // a safe fallback rather than throwing.
      return formatDate(todayOnly);
    }
  }
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

```bash
git add frontend/src/utils/suggestStartDate.ts
git commit -m "feat: add suggestStartDate helper for applying schedule patterns"
```

---

## Task 7: Frontend — `PatternForm`, `SchedulePatternsPage`, nav, route

**Files:**
- Create: `frontend/src/components/household/PatternForm.tsx`
- Create: `frontend/src/pages/SchedulePatternsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/UserMenu.tsx`

**Interfaces:**
- Consumes: `SchedulePattern`/`CreatePatternInput` (Task 5), `FormField` (`../common/FormField`).
- Produces: `PatternForm`, `SchedulePatternsPage` — nothing later depends on these beyond routing/nav.

- [ ] **Step 1: Write `PatternForm`**

Create `frontend/src/components/household/PatternForm.tsx`:

```typescript
import { useState, type FormEvent } from 'react';
import type { CreatePatternInput, PatternRecurrenceType } from '../../types/pattern';
import { FormField } from '../common/FormField';

interface PatternFormProps {
  submitting: boolean;
  onSubmit: (input: CreatePatternInput) => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PatternForm({ submitting, onSubmit }: PatternFormProps) {
  const [name, setName] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<PatternRecurrenceType>('every_n_days');
  const [startTime, setStartTime] = useState('09:00');
  const [intervalDays, setIntervalDays] = useState(1);
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [intervalMonths, setIntervalMonths] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);

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
    const trimmedName = name.trim();
    if (!trimmedName) return;

    switch (recurrenceType) {
      case 'every_n_days':
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalDays });
        break;
      case 'weekly':
        if (weekdays.size === 0) return;
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalWeeks, weekdays: [...weekdays] });
        break;
      case 'monthly':
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalMonths, dayOfMonth });
        break;
    }

    setName('');
  }

  return (
    <form className="chore-schedule-form" onSubmit={handleSubmit}>
      <FormField label="Pattern name" name="patternName" value={name} onChange={setName} required />

      <label className="schedule-field">
        Repeats
        <select
          value={recurrenceType}
          onChange={(event) => setRecurrenceType(event.target.value as PatternRecurrenceType)}
        >
          <option value="every_n_days">Every few days</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>

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
        <>
          <label className="schedule-field">
            Every
            <input
              type="number"
              min={1}
              max={24}
              value={intervalMonths}
              onChange={(event) => setIntervalMonths(Number(event.target.value))}
            />
            month(s), on day
          </label>
          <label className="schedule-field">
            Day of month
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(Number(event.target.value))}
            />
          </label>
        </>
      )}

      <FormField label="At" name="patternStartTime" type="time" value={startTime} onChange={setStartTime} required />

      <button type="submit" className="btn btn-pill-outline" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save pattern'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Write `SchedulePatternsPage`**

Create `frontend/src/pages/SchedulePatternsPage.tsx`, modeled on `frontend/src/pages/ZonesPage.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { PatternForm } from '../components/household/PatternForm';
import { ErrorBanner } from '../components/common/ErrorBanner';
import * as patternApi from '../api/patternApi';
import { ApiError } from '../api/httpClient';
import type { CreatePatternInput, SchedulePattern } from '../types/pattern';

const RECURRENCE_LABEL: Record<SchedulePattern['recurrenceType'], (pattern: SchedulePattern) => string> = {
  every_n_days: (pattern) => `Every ${pattern.intervalDays} day(s) at ${pattern.startTime}`,
  weekly: (pattern) => `Every ${pattern.intervalWeeks} week(s) at ${pattern.startTime}`,
  monthly: (pattern) => `Every ${pattern.intervalMonths} month(s) on day ${pattern.dayOfMonth} at ${pattern.startTime}`,
};

export function SchedulePatternsPage() {
  const { householdId: householdIdParam } = useParams();
  const householdId = Number(householdIdParam);
  const { state } = useAuth();

  const [patterns, setPatterns] = useState<SchedulePattern[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const household =
    state.status === 'authenticated'
      ? state.households.find((candidate) => candidate.id === householdId)
      : undefined;

  useEffect(() => {
    if (!household) return;
    let cancelled = false;
    patternApi
      .listPatterns(householdId)
      .then((result) => {
        if (!cancelled) setPatterns(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load schedule patterns.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, household]);

  async function handleCreate(input: CreatePatternInput) {
    setBusy(true);
    setError(null);
    try {
      const created = await patternApi.createPattern(householdId, input);
      setPatterns((prev) => [...(prev ?? []), created]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that pattern.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(patternId: number) {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await patternApi.renamePattern(householdId, patternId, { name: trimmed });
      setPatterns((prev) => prev?.map((pattern) => (pattern.id === patternId ? updated : pattern)) ?? prev);
      setRenamingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename that pattern.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(patternId: number) {
    setBusy(true);
    setError(null);
    try {
      await patternApi.removePattern(householdId, patternId);
      setPatterns((prev) => prev?.filter((pattern) => pattern.id !== patternId) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that pattern.');
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') return null;
  if (!household) {
    return <Navigate to="/" replace />;
  }
  const isHead = household.role === 'head';

  return (
    <div className="card">
      <h1>Schedule patterns</h1>
      <p className="card-eyebrow">For {household.name}</p>
      <ErrorBanner message={error} />
      {patterns ? (
        <ul className="pattern-list">
          {patterns.map((pattern) => (
            <li className="pattern-list-item" key={pattern.id}>
              {renamingId === pattern.id ? (
                <span className="pattern-rename-form">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-text"
                    disabled={busy}
                    onClick={() => void handleRename(pattern.id)}
                  >
                    Save
                  </button>
                  <button type="button" className="btn btn-text" onClick={() => setRenamingId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <span className="pattern-name">{pattern.name}</span>
                  <span className="pattern-summary">{RECURRENCE_LABEL[pattern.recurrenceType](pattern)}</span>
                  {isHead && (
                    <span className="pattern-actions">
                      <button
                        type="button"
                        className="btn btn-text"
                        onClick={() => {
                          setRenamingId(pattern.id);
                          setRenameValue(pattern.name);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn-text"
                        disabled={busy}
                        onClick={() => void handleRemove(pattern.id)}
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !error && <p className="members-loading">Loading patterns…</p>
      )}
      {isHead && <PatternForm submitting={busy} onSubmit={(input) => void handleCreate(input)} />}
      <p className="card-footer">
        <Link to="/">Back</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Wire the route**

In `frontend/src/App.tsx`, add the import:

```typescript
import { SchedulePatternsPage } from './pages/SchedulePatternsPage';
```

And add, alongside the other protected routes:

```typescript
<Route path="/households/:householdId/patterns" element={<SchedulePatternsPage />} />
```

- [ ] **Step 4: Wire the nav link**

In `frontend/src/components/layout/UserMenu.tsx`, add a new link right after the existing "Members" link (inside the same `household &&` block):

```typescript
              <Link
                role="menuitem"
                to={`/households/${household.id}/patterns`}
                onClick={() => setIsOpen(false)}
              >
                Schedule patterns
              </Link>
```

- [ ] **Step 5: Typecheck, lint, commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both PASS.

```bash
git add frontend/src/components/household/PatternForm.tsx frontend/src/pages/SchedulePatternsPage.tsx frontend/src/App.tsx frontend/src/components/layout/UserMenu.tsx
git commit -m "feat: add schedule patterns management page"
```

---

## Task 8: `ChoreScheduleForm` — pattern picker and "save as pattern"

**Files:**
- Modify: `frontend/src/components/household/ChoreScheduleForm.tsx`

**Interfaces:**
- Consumes: `SchedulePattern`/`CreatePatternInput` (Task 5), `suggestStartDate` (Task 6).
- Produces: two new props (`patterns`, `onSaveAsPattern`) — consumed by Task 9 (`ChoreScheduleControl`) and Task 12 (`BulkScheduleBar`).

- [ ] **Step 1: Rewrite the component**

Replace the full contents of `frontend/src/components/household/ChoreScheduleForm.tsx` with:

```typescript
import { useState, type FormEvent } from 'react';
import type { RecurrenceType, Schedule, ScheduleInput } from '../../types/schedule';
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
import { FormField } from '../common/FormField';
import { suggestStartDate } from '../../utils/suggestStartDate';

interface ChoreScheduleFormProps {
  schedule: Schedule | null;
  patterns: SchedulePattern[];
  submitting: boolean;
  onSave: (input: ScheduleInput) => void;
  onSaveAsPattern: (input: CreatePatternInput) => void;
  onCancel: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ChoreScheduleForm({
  schedule,
  patterns,
  submitting,
  onSave,
  onSaveAsPattern,
  onCancel,
}: ChoreScheduleFormProps) {
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(schedule?.recurrenceType ?? 'once');
  const [startDate, setStartDate] = useState(schedule?.startDate ?? '');
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '09:00');
  const [intervalDays, setIntervalDays] = useState(schedule?.intervalDays ?? 1);
  const [intervalWeeks, setIntervalWeeks] = useState(schedule?.intervalWeeks ?? 1);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(schedule?.weekdays ?? []));
  const [intervalMonths, setIntervalMonths] = useState(schedule?.intervalMonths ?? 1);
  const [saveAsPattern, setSaveAsPattern] = useState(false);
  const [patternName, setPatternName] = useState('');

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

  // Pre-fills every field a pattern carries, plus a suggested Date the user can
  // still change before saving — see suggestStartDate.ts.
  function applyPattern(patternId: string) {
    const pattern = patterns.find((candidate) => String(candidate.id) === patternId);
    if (!pattern) return;

    setRecurrenceType(pattern.recurrenceType);
    setStartTime(pattern.startTime);
    if (pattern.intervalDays !== null) setIntervalDays(pattern.intervalDays);
    if (pattern.intervalWeeks !== null) setIntervalWeeks(pattern.intervalWeeks);
    if (pattern.weekdays !== null) setWeekdays(new Set(pattern.weekdays));
    if (pattern.intervalMonths !== null) setIntervalMonths(pattern.intervalMonths);
    setStartDate(suggestStartDate(pattern));
  }

  // Mirrors scheduleService.ts's buildRowValues: dayOfMonth for a saved pattern is
  // derived from the form's current Date, the same rule the backend already applies
  // when saving the schedule itself — there is no separate dayOfMonth field/state to
  // keep in sync.
  function buildPatternInput(name: string): CreatePatternInput | null {
    switch (recurrenceType) {
      case 'every_n_days':
        return { recurrenceType, name, startTime, intervalDays };
      case 'weekly':
        return { recurrenceType, name, startTime, intervalWeeks, weekdays: [...weekdays] };
      case 'monthly':
        return {
          recurrenceType,
          name,
          startTime,
          intervalMonths,
          dayOfMonth: Number(startDate.split('-')[2]),
        };
      case 'once':
        return null;
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!startDate) return;

    switch (recurrenceType) {
      case 'once':
        onSave({ recurrenceType, startDate, startTime });
        break;
      case 'every_n_days':
        onSave({ recurrenceType, startDate, startTime, intervalDays });
        break;
      case 'weekly':
        if (weekdays.size === 0) return;
        onSave({ recurrenceType, startDate, startTime, intervalWeeks, weekdays: [...weekdays] });
        break;
      case 'monthly':
        onSave({ recurrenceType, startDate, startTime, intervalMonths });
        break;
    }

    const trimmedName = patternName.trim();
    if (saveAsPattern && trimmedName) {
      const patternInput = buildPatternInput(trimmedName);
      if (patternInput) onSaveAsPattern(patternInput);
    }
  }

  return (
    <form className="chore-schedule-form" onSubmit={handleSubmit}>
      {patterns.length > 0 && (
        <label className="schedule-field">
          Use a pattern
          <select defaultValue="" onChange={(event) => applyPattern(event.target.value)}>
            <option value="" disabled>
              Choose a saved pattern…
            </option>
            {patterns.map((pattern) => (
              <option key={pattern.id} value={pattern.id}>
                {pattern.name}
              </option>
            ))}
          </select>
        </label>
      )}

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

      <FormField
        label={recurrenceType === 'once' ? 'Date' : 'Start date'}
        name="scheduleStartDate"
        type="date"
        value={startDate}
        onChange={setStartDate}
        required
      />

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

      <FormField label="At" name="scheduleStartTime" type="time" value={startTime} onChange={setStartTime} required />

      {recurrenceType !== 'once' && (
        <label className="schedule-field schedule-save-as-pattern">
          <span>
            <input
              type="checkbox"
              checked={saveAsPattern}
              onChange={(event) => setSaveAsPattern(event.target.checked)}
            />
            Save as a reusable pattern
          </span>
          {saveAsPattern && (
            <input
              type="text"
              placeholder="Pattern name"
              value={patternName}
              onChange={(event) => setPatternName(event.target.value)}
              required
            />
          )}
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

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: FAIL at this point — `ChoreScheduleControl.tsx` doesn't yet pass the two new required props. That's expected; Task 9 fixes it. Confirm the only errors are about `ChoreScheduleForm`'s callers missing `patterns`/`onSaveAsPattern`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/household/ChoreScheduleForm.tsx
git commit -m "feat: add pattern picker and save-as-pattern to the schedule form"
```

---

## Task 9: `ChoreScheduleControl` passthrough

**Files:**
- Modify: `frontend/src/components/household/ChoreScheduleControl.tsx`

**Interfaces:**
- Consumes: `ChoreScheduleForm`'s new props (Task 8).
- Produces: two new props (`patterns`, `onSaveAsPattern`) on `ChoreScheduleControl` — consumed by Task 10.

- [ ] **Step 1: Thread the new props through**

In `frontend/src/components/household/ChoreScheduleControl.tsx`, add the import:

```typescript
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
```

Add to `ChoreScheduleControlProps`:

```typescript
  patterns: SchedulePattern[];
  onSaveAsPattern: (input: CreatePatternInput) => void;
```

Add to the destructured params, and pass both straight through to `<ChoreScheduleForm>`:

```typescript
      <ChoreScheduleForm
        schedule={schedule}
        patterns={patterns}
        submitting={submitting}
        onSave={(input) => {
          onSave(input);
          setEditing(false);
        }}
        onSaveAsPattern={onSaveAsPattern}
        onCancel={() => setEditing(false)}
      />
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: FAIL — `ChoreRow.tsx`/`ChoreZoneSection.tsx` don't yet pass the two new required props to `ChoreScheduleControl`. Expected; Task 10 fixes it.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/household/ChoreScheduleControl.tsx
git commit -m "feat: thread pattern props through ChoreScheduleControl"
```

---

## Task 10: `ChoreRow`/`ChoreZoneSection` — pattern passthrough and select-mode checkboxes

**Files:**
- Modify: `frontend/src/components/household/ChoreRow.tsx`
- Modify: `frontend/src/components/household/ChoreZoneSection.tsx`

**Interfaces:**
- Consumes: `ChoreScheduleControl`'s new props (Task 9).
- Produces: new props on both components — `patterns`, `onSaveAsPattern`, `selectMode`, `selectedTargets`, `onToggleTarget` — consumed by Task 11 (`ChoresList`).

- [ ] **Step 1: Update `ChoreRow.tsx`**

Add the import:

```typescript
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
```

Add to `ChoreRowProps`:

```typescript
  patterns: SchedulePattern[];
  onSaveAsPattern: (input: CreatePatternInput) => void;
  selectMode: boolean;
  selectedTargets: Set<string>;
  onToggleTarget: (choreId: number, zoneId: number | null) => void;
```

Add to the destructured params (matching the props above).

Replace the existing zoneless-chore block:

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

with:

```typescript
      {!hasZones && (
        <div className="chore-schedule-row">
          {selectMode && (
            <label className="chore-select-checkbox">
              <input
                type="checkbox"
                checked={selectedTargets.has(scheduleKey)}
                onChange={() => onToggleTarget(chore.id, null)}
              />
            </label>
          )}
          <ChoreScheduleControl
            schedule={scheduleByTarget.get(scheduleKey) ?? null}
            patterns={patterns}
            isHead={isHead}
            submitting={scheduleSubmittingKey === scheduleKey}
            onSave={(input) => onSetSchedule(chore.id, null, input)}
            onSaveAsPattern={onSaveAsPattern}
            onRemove={() => onRemoveSchedule(chore.id, null)}
          />
        </div>
      )}
```

And thread the five new props into every `<ChoreZoneSection ...>` it renders:

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
              patterns={patterns}
              onSaveAsPattern={onSaveAsPattern}
              selectMode={selectMode}
              selectedTargets={selectedTargets}
              onToggleTarget={onToggleTarget}
            />
```

- [ ] **Step 2: Update `ChoreZoneSection.tsx`**

Add the same import and the same five new props to `ChoreZoneSectionProps` and the destructured params.

Replace the existing `<ChoreScheduleControl ...>` call (inside the `expanded && (...)` block) with:

```typescript
          <div className="chore-schedule-row">
            {selectMode && (
              <label className="chore-select-checkbox">
                <input
                  type="checkbox"
                  checked={selectedTargets.has(scheduleKey)}
                  onChange={() => onToggleTarget(choreId, zone.zoneId)}
                />
              </label>
            )}
            <ChoreScheduleControl
              schedule={scheduleByTarget.get(scheduleKey) ?? null}
              patterns={patterns}
              isHead={isHead}
              submitting={scheduleSubmittingKey === scheduleKey}
              onSave={(input) => onSetSchedule(choreId, zone.zoneId, input)}
              onSaveAsPattern={onSaveAsPattern}
              onRemove={() => onRemoveSchedule(choreId, zone.zoneId)}
            />
          </div>
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: FAIL — `ChoresList.tsx` doesn't yet supply the new required props to `ChoreRow`. Expected; Task 11 fixes it. Confirm the only errors are on `ChoreRow`'s callers.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/household/ChoreRow.tsx frontend/src/components/household/ChoreZoneSection.tsx
git commit -m "feat: add pattern and select-mode props to chore/zone rows"
```

---

## Task 11: `ChoresList` passthrough

**Files:**
- Modify: `frontend/src/components/household/ChoresList.tsx`

**Interfaces:**
- Consumes: `ChoreRow`'s new props (Task 10).
- Produces: the same new props on `ChoresList` — consumed by Task 12 (`HouseholdCard`).

- [ ] **Step 1: Thread the new props through**

Add the import:

```typescript
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
```

Add to `ChoresListProps`:

```typescript
  patterns: SchedulePattern[];
  onSaveAsPattern: (input: CreatePatternInput) => void;
  selectMode: boolean;
  selectedTargets: Set<string>;
  onToggleTarget: (choreId: number, zoneId: number | null) => void;
```

Add to the destructured params and pass through to `<ChoreRow ...>`:

```typescript
          patterns={patterns}
          onSaveAsPattern={onSaveAsPattern}
          selectMode={selectMode}
          selectedTargets={selectedTargets}
          onToggleTarget={onToggleTarget}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: FAIL — `HouseholdCard.tsx` doesn't yet supply the new required props to `ChoresList`. Expected; Task 12 fixes it.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/household/ChoresList.tsx
git commit -m "feat: thread pattern and select-mode props through ChoresList"
```

---

## Task 12: `BulkScheduleBar` and `HouseholdCard` orchestration

**Files:**
- Create: `frontend/src/components/household/BulkScheduleBar.tsx`
- Modify: `frontend/src/components/household/HouseholdCard.tsx`

**Interfaces:**
- Consumes: `patternApi` (Task 5), `ChoreScheduleForm` (Task 8), `ChoresList`'s new props (Task 11).

This task closes the deliberate typecheck gap the previous three tasks left open.

- [ ] **Step 1: Write `BulkScheduleBar`**

Create `frontend/src/components/household/BulkScheduleBar.tsx`:

```typescript
import { useState } from 'react';
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
import type { ScheduleInput } from '../../types/schedule';
import { ChoreScheduleForm } from './ChoreScheduleForm';

interface BulkScheduleBarProps {
  isHead: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedCount: number;
  patterns: SchedulePattern[];
  submitting: boolean;
  resultMessage: string | null;
  // Returns a Promise, awaited below, rather than firing-and-forgetting: the
  // inline form (and its Save/Cancel buttons, disabled via `submitting`) must stay
  // mounted until the actual batch of requests resolves. An earlier version closed
  // the form the instant onApply was called, before its requests finished — which
  // re-revealed the "Apply schedule to N selected" trigger button while the batch
  // was still in flight, letting a user fire a second overlapping batch against the
  // same targets.
  onApply: (input: ScheduleInput) => Promise<void>;
  onSaveAsPattern: (input: CreatePatternInput) => void;
}

export function BulkScheduleBar({
  isHead,
  selectMode,
  onToggleSelectMode,
  selectedCount,
  patterns,
  submitting,
  resultMessage,
  onApply,
  onSaveAsPattern,
}: BulkScheduleBarProps) {
  const [applying, setApplying] = useState(false);

  if (!isHead) return null;

  async function handleApply(input: ScheduleInput) {
    await onApply(input);
    setApplying(false);
  }

  return (
    <div className="bulk-schedule-bar">
      <button type="button" className="btn btn-pill-outline" onClick={onToggleSelectMode}>
        {selectMode ? 'Cancel' : 'Select chores'}
      </button>
      {selectMode && selectedCount > 0 && !applying && (
        <>
          <span className="bulk-schedule-count">{selectedCount} selected</span>
          <button type="button" className="btn btn-pill-outline" onClick={() => setApplying(true)}>
            Apply schedule to {selectedCount} selected
          </button>
        </>
      )}
      {resultMessage && <span className="bulk-schedule-result">{resultMessage}</span>}
      {applying && (
        <ChoreScheduleForm
          schedule={null}
          patterns={patterns}
          submitting={submitting}
          onSave={(input) => void handleApply(input)}
          onSaveAsPattern={onSaveAsPattern}
          onCancel={() => setApplying(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `HouseholdCard.tsx`**

Add imports:

```typescript
import * as patternApi from '../../api/patternApi';
import { BulkScheduleBar } from './BulkScheduleBar';
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
```

Add state, alongside the existing `useState` calls:

```typescript
  const [patterns, setPatterns] = useState<SchedulePattern[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResultMessage, setBulkResultMessage] = useState<string | null>(null);
```

Add a data-loading effect, alongside the existing `scheduleApi` effect:

```typescript
  useEffect(() => {
    let cancelled = false;
    patternApi
      .listPatterns(household.id)
      .then((result) => {
        if (!cancelled) setPatterns(result);
      })
      .catch(() => {
        // Same rationale as members/schedules above: patterns are a convenience for
        // setting up a schedule faster, not required to view or manage chores.
      });
    return () => {
      cancelled = true;
    };
  }, [household.id]);
```

Add the handlers, alongside `handleSetSchedule`/`handleRemoveSchedule`:

```typescript
  async function handleSaveAsPattern(input: CreatePatternInput) {
    try {
      const created = await patternApi.createPattern(household.id, input);
      setPatterns((prev) => [...prev, created]);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not save that pattern.');
    }
  }

  function toggleSelectMode() {
    setSelectMode((prev) => !prev);
    setSelectedTargets(new Set());
    setBulkResultMessage(null);
  }

  function handleToggleTarget(choreId: number, zoneId: number | null) {
    const key = `${choreId}:${zoneId ?? 'none'}`;
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleBulkApplySchedule(input: ScheduleInput) {
    setBulkSubmitting(true);
    setBulkResultMessage(null);

    const targets = [...selectedTargets].map((key) => {
      const [choreIdText, zoneIdText] = key.split(':');
      return {
        choreId: Number(choreIdText),
        zoneId: zoneIdText === 'none' ? null : Number(zoneIdText),
      };
    });

    const results = await Promise.allSettled(
      targets.map((target) =>
        target.zoneId === null
          ? scheduleApi.setChoreSchedule(household.id, target.choreId, input)
          : scheduleApi.setChoreZoneSchedule(household.id, target.choreId, target.zoneId, input),
      ),
    );

    const updates = results
      .map((result, index) =>
        result.status === 'fulfilled' ? { ...targets[index], schedule: result.value } : null,
      )
      .filter((update): update is { choreId: number; zoneId: number | null; schedule: Schedule } => update !== null);

    setSchedules((prev) => {
      const remaining = prev.filter(
        (schedule) =>
          !updates.some((update) => update.choreId === schedule.choreId && update.zoneId === schedule.zoneId),
      );
      return [
        ...remaining,
        ...updates.map((update) => ({ ...update.schedule, choreId: update.choreId, zoneId: update.zoneId })),
      ];
    });

    const succeeded = updates.length;
    const failed = results.length - succeeded;
    setBulkResultMessage(
      failed === 0
        ? `Applied to all ${succeeded} selected.`
        : `Applied to ${succeeded} of ${results.length} — ${failed} failed.`,
    );
    setBulkSubmitting(false);
    setSelectMode(false);
    setSelectedTargets(new Set());
  }
```

Render `<BulkScheduleBar>` right before `<ChoresList>` (inside the `{chores && zoneTree ? (...) : ...}` branch), and pass the new props into `<ChoresList>`:

```typescript
        <ChoresList
          chores={filterChores(chores, filter, state.user.id)}
          allChoresCount={chores.length}
          zoneNameById={new Map(flattenZones(zoneTree).map((zone) => [zone.id, zone.name]))}
          members={members}
          currentUserId={state.user.id}
          isHead={isHead}
          assigningKey={assigningKey}
          onAssign={(choreId, userId, zoneId) => void handleAssign(choreId, userId, zoneId)}
          unassigningId={unassigningId}
          onUnassign={(choreId, assignmentId) => void handleUnassign(choreId, assignmentId)}
          statusUpdatingKey={statusUpdatingKey}
          onSetStatus={(choreId, zoneId, status) => void handleSetStatus(choreId, zoneId, status)}
          removingChoreId={removingChoreId}
          onRemove={(choreId) => void handleRemoveChore(choreId)}
          scheduleByTarget={scheduleByTarget}
          scheduleSubmittingKey={scheduleSubmittingKey}
          onSetSchedule={(choreId, zoneId, input) => void handleSetSchedule(choreId, zoneId, input)}
          onRemoveSchedule={(choreId, zoneId) => void handleRemoveSchedule(choreId, zoneId)}
          patterns={patterns}
          onSaveAsPattern={(input) => void handleSaveAsPattern(input)}
          selectMode={selectMode}
          selectedTargets={selectedTargets}
          onToggleTarget={handleToggleTarget}
        />
```

Add `<BulkScheduleBar>` immediately above that `<ChoresList>` element, inside the same conditional branch:

```typescript
        <BulkScheduleBar
          isHead={isHead}
          selectMode={selectMode}
          onToggleSelectMode={toggleSelectMode}
          selectedCount={selectedTargets.size}
          patterns={patterns}
          submitting={bulkSubmitting}
          resultMessage={bulkResultMessage}
          onApply={(input) => handleBulkApplySchedule(input)}
          onSaveAsPattern={(input) => void handleSaveAsPattern(input)}
        />
```

Note `onApply` is passed WITHOUT the `void` prefix here, unlike every other async handler in this file — `BulkScheduleBar`'s `onApply` prop is now typed `(input: ScheduleInput) => Promise<void>` (see its own file above), specifically so it can `await` this call and keep its form mounted until the batch actually finishes, rather than fire-and-forgetting it the way `onSetSchedule`/`onSaveAsPattern` do.

`ScheduleInput` needs to be imported (it's already used in this file's `handleSetSchedule`); confirm `Schedule` (not just `ScheduleWithTarget`) is imported too, since `handleBulkApplySchedule`'s `updates` typing references it — both are already imported per the file's current `import type { Schedule, ScheduleInput, ScheduleWithTarget } from '../../types/schedule';` line, so no import change should be needed here specifically.

- [ ] **Step 3: Typecheck, lint — this should now be fully clean**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both PASS with zero errors, closing the gap the previous three tasks deliberately left open.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/household/BulkScheduleBar.tsx frontend/src/components/household/HouseholdCard.tsx
git commit -m "feat: add bulk-apply schedule flow"
```

---

## Task 13: CSS for patterns, select mode, and bulk-apply

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Read the file's existing tokens and nearby patterns**

Read `frontend/src/index.css` in full (particularly the `/* ---------- chore scheduling ---------- */` section this feature already added, and the `.zone-tree`/`.zone-picker-option` rules `ZoneTree`/`CreateChoreForm` use) so the new rules below reuse existing custom properties and don't duplicate a slightly-different-looking pattern.

- [ ] **Step 2: Add the new rules**

Add, after the existing `.schedule-form-actions` rule in the `/* ---------- chore scheduling ---------- */` section:

```css
.schedule-save-as-pattern {
  gap: 6px;
}

.schedule-save-as-pattern span {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.schedule-save-as-pattern input[type='text'] {
  font: inherit;
  font-size: 0.9rem;
  font-weight: 400;
  color: var(--ink);
  background: var(--card);
  border: 2px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
}

.chore-schedule-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.chore-select-checkbox {
  display: inline-flex;
  align-items: center;
  padding-top: 4px;
}

.pattern-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 12px 0;
  padding: 0;
  list-style: none;
}

.pattern-list-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border: 2px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
}

.pattern-name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.1rem;
}

.pattern-summary {
  font-size: 0.8rem;
  color: var(--muted);
}

.pattern-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.pattern-rename-form {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.pattern-rename-form input[type='text'] {
  font: inherit;
  font-size: 0.9rem;
  color: var(--ink);
  background: var(--card);
  border: 2px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
}

.bulk-schedule-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 12px 0;
}

.bulk-schedule-count {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--muted);
}

.bulk-schedule-result {
  font-size: 0.85rem;
  color: var(--accent-2);
}
```

All values reuse existing custom properties (`--ink`, `--muted`, `--card`, `--paper`, `--line`, `--radius-sm`, `--font-display`, `--accent-2`) — no hardcoded colors or fonts, per `CLAUDE.md`.

- [ ] **Step 3: Typecheck, lint, commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both PASS (CSS isn't typechecked, but this confirms nothing else broke).

```bash
git add frontend/src/index.css
git commit -m "feat: add styles for schedule patterns and bulk-apply"
```

---

## Task 14: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the isolated dev servers**

Run: `npm run dev:ai` from the repo root (never `npm run dev`).

- [ ] **Step 2: Manual walkthrough**

Using the browser at `http://localhost:4173`:
1. Register a household as its head, create two chores (one zoneless, one with a zone).
2. Go to "Schedule patterns" (hamburger menu) and create one pattern of each type: `every_n_days`, `weekly` (pick 2 weekdays), `monthly` (pick a day-of-month, e.g. 31st, to exercise the non-clamping search-forward behavior).
3. Open the zoneless chore's schedule form. Confirm the "Use a pattern" picker lists all three. Selecting each one pre-fills Repeats/Every/weekdays/At correctly, and Date gets a sensible suggested value for each (today for every_n_days; the next matching weekday for weekly; the next month that actually has that day-of-month — never clamped to a short month's last day, see the comment in suggestStartDate.ts — for monthly).
4. Save a schedule with "Save as a reusable pattern" checked and a name; confirm it now appears on the Schedule patterns page with the right summary.
5. Rename and then remove one pattern from that page; confirm the picker in the schedule form reflects both changes without a page reload.
6. Click "Select chores." Confirm a checkbox appears next to the zoneless chore's own schedule control and next to the zoned chore's zone (but never next to the zoned chore's own row, which can't carry its own schedule).
7. Select both, click "Apply schedule to 2 selected," pick a pattern, save. Confirm both targets now show the new schedule and the result message reads "Applied to all 2 selected."
8. Repeat but include an intentionally invalid mix if easy to construct (or skip if not) to see the partial-failure summary wording; otherwise confirm the happy-path summary alone is sufficient evidence the mechanism works.

- [ ] **Step 3: Stop the dev servers by port**

```bash
lsof -tiTCP:4001 -sTCP:LISTEN | xargs -r kill
lsof -tiTCP:4173 -sTCP:LISTEN | xargs -r kill
```

- [ ] **Step 4: Full workspace verification**

```bash
cd backend && npm run typecheck && npm run lint && npm test
cd ../frontend && npm run typecheck && npm run lint
```
Expected: all PASS.

- [ ] **Step 5: Post-change review**

Per `CLAUDE.md`'s "Post-change review workflow," do three separate re-reads of the full diff (correctness, architecture, security) before considering this done.
