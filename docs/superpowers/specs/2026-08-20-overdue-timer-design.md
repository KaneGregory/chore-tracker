# Overdue timer (scheduling phase 2) — design

## Purpose

Phase 1 (`docs/superpowers/specs/2026-08-13-scheduling-design.md`) automated the
`complete`/`overdue` → `to-do` transition via `chore_schedules`. This is phase 2: the
`to-do` → `overdue` rule that spec explicitly left undesigned. A schedule (for any
recurrence type, including `once`) can carry an optional overdue timer: an amount of
time — minutes, hours, or days — since the chore/chore-zone's most recent transition
*into* `to-do`, after which it automatically flips to `overdue` if it's still `to-do`.

## Scope decisions

Reached through discussion before this spec was written:

- The timer requires a schedule to already exist for that chore/chore-zone — it's one
  more optional field on the existing schedule create/edit form, not a standalone
  feature. A chore with no recurring reopen behavior can still use it by setting a
  `once` schedule with just the timer configured (a real `startDate`/`startTime` is
  still required by the existing form, but its own one-time reopen behavior and the
  overdue timer are independent of each other once saved).
- The "most recent change to `to-do`" clock counts *every* path that actually
  transitions status into `to-do` — a manual member action, a human reopening a
  completed chore, or the phase-1 scheduler's own system-triggered reopen. All are
  equivalent triggers for this feature.
- A redundant `to-do` → `to-do` write (already `to-do`, set to `to-do` again) does
  **not** restart the clock — only a real transition from a different status does.
  This mirrors the existing precedent in `notificationBatcher.ts`/`choreService.ts`,
  which already distinguishes a genuine `complete` → `to-do` reopen from a same-state
  no-op write.
- The overdue duration is stored exactly as entered (an amount + a unit), not
  normalized to a single minutes value — mirrors how `intervalDays`/`intervalWeeks`/
  `intervalMonths` already work, and avoids "2 days" redisplaying as "2880" unless the
  UI re-derives a unit from a raw number.
- Schedule templates (`schedule_patterns`) can also carry an overdue timer, so
  applying a saved template pre-fills it along with the recurrence shape.
- No live countdown anywhere in the UI (e.g. "becomes overdue in 3h12m") — only the
  static configured duration is shown, consistent with `nextRunAt` also not being
  live-rendered today (a known, accepted gap from phase 1).

## Data model

New nullable columns on `chore_schedules` (migration; no table recreation — see
CLAUDE.md's migration-safety note, which only applies to migrations that recreate a
table, not plain `ADD COLUMN`):

- `overdueAfterAmount` (integer) — the number the user typed.
- `overdueAfterUnit` (`'minutes' | 'hours' | 'days'`) — the unit they picked.
- Both null (no timer configured) or both set together — enforced by a `CHECK`
  constraint mirroring the existing "exactly one of choreId/choreZoneId" pattern
  already on this table.
- `overdueAt` (integer epoch ms, nullable, indexed) — precomputed "check at" instant,
  the same shape and role as the existing `nextRunAt` column: lets the poller do a
  plain indexed range query instead of recomputing a duration on every tick.

New nullable columns tracking "when did this chore/zone most recently become
`to-do`":

- `chores.todoSince` (integer epoch ms, nullable).
- `choreZones.todoSince` (integer epoch ms, nullable).

Both are updated in the same place `chores.status`/`choreZones.status` itself is
written, whenever the new status is `'to-do'` and the previous status (or "just
created" — a brand-new chore/zone defaults to `to-do`) was anything other than
`'to-do'`. A write that leaves status at `'to-do'` (already `to-do`, set to `to-do`
again) leaves `todoSince` untouched.

**Migration backfill:** existing rows have no history to derive a real "became
to-do" instant from, so the migration backfills `todoSince` to the migration's own
run time for every chore/chore-zone whose current status is already `'to-do'`
(`complete`/`overdue` rows are left `null` — irrelevant until they next transition
into `to-do`, at which point the normal write path sets it correctly). Practically,
this means a chore that's been sitting in `to-do` since before this migration has its
clock start over at upgrade time if a head later adds an overdue timer to it — a
reasonable simplification given there's no way to know the real original instant.

`schedule_patterns` (schedule templates) gets the same `overdueAfterAmount` +
`overdueAfterUnit` pair as `chore_schedules`, with the same co-nullability `CHECK`.
No `overdueAt` there — a template is never itself evaluated by the scheduler (same
reasoning phase 1 already applied to templates having no `nextRunAt`).

## Firing rule

`overdueAt` is (re)computed at exactly two moments:

1. **A schedule is created/replaced** (`insertSchedule` in `scheduleService.ts`,
   which already deletes-then-reinserts the whole row): if the new schedule has an
   overdue timer configured *and* the target's current status is `'to-do'`,
   `overdueAt = todoSince + duration` (falling back to "now" as the effective
   `todoSince` in the defensive case where it's somehow still `null` despite the
   target being `'to-do'` — shouldn't happen after the migration backfill, but costs
   nothing to guard). If the target isn't currently `'to-do'`, or no timer is
   configured, `overdueAt` is `null` — nothing to check yet.
2. **The target transitions into `to-do`** (any of the four status-mutation paths in
   `choreService.ts` — `setChoreStatus`, `setChoreZoneStatus`, `systemReopenChore`,
   `systemReopenChoreZone` — whenever that specific call actually changes `todoSince`,
   per the redundant-write rule above): after updating `todoSince`, look up whether
   this target has a `chore_schedules` row with a non-null timer; if so, recompute
   `overdueAt` from the fresh `todoSince`. If the target has no schedule row, there's
   nothing to recompute.

When a target transitions *out* of `to-do` (to `complete` or `overdue`), `overdueAt`
is left alone rather than eagerly cleared — the poller's own no-op path (below) clears
it lazily the next time it's due, which keeps this rule in exactly one place.

## Scheduler mechanics

`choreScheduler.ts` gains a second due-query alongside the existing `nextRunAt` one,
polled on the same 60-second interval (same `setInterval`, no second timer):
`overdueAt IS NOT NULL AND overdueAt <= now`.

For each due row: resolve the target (reusing `resolveTarget`), and re-check its
*current* status — since this is a one-shot deadline check, not a repeating cadence,
the outcome depends on live state at check time, not at schedule time:

- Still `'to-do'` → flip to `'overdue'` via a new `systemMarkOverdue`/
  `systemMarkOverdueZone` pair in `choreService.ts` (mirroring `systemReopenChore`/
  `systemReopenChoreZone`: no requesting user, skips the human-only role check that
  gates the manual "Mark overdue" button, reuses the exact same
  `queueOverdueNotification` path so assignees are notified the same way a
  head-triggered overdue already notifies them).
- Anything else (completed in time, already overdue via another path) → no-op.

Either way, `overdueAt` is cleared to `null` afterward — it doesn't get a next value
until the target transitions into `to-do` again. Per-row failures are caught and
disable just that row (`overdueAt` set to `null`), the same isolation the existing
`nextRunAt` poll loop already applies, so one malformed row can never take down the
whole process.

## API and validation

- `PUT .../chores/:choreId/schedule` and `PUT .../chores/:choreId/zones/:zoneId/schedule`
  (`scheduleSchemas.ts`'s `setScheduleSchema`) gain an optional
  `overdueAfter: { amount: number; unit: 'minutes' | 'hours' | 'days' }` field on every
  recurrence variant, including `once`. Omitting it means "no timer."
- `amount` bounded to 1–999 for any unit — generous, sanity-checked, no need for a
  different max per unit.
- No new authorization surface: setting/replacing/removing a schedule (and therefore
  its timer) stays Head-of-Household-only, exactly as today.
- `POST .../households/:householdId/patterns` (`patternSchemas.ts`) gains the same
  optional `overdueAfter` field on its three variants (`every_n_days`/`weekly`/
  `monthly` — `once` isn't a pattern type, unchanged from phase 1).
- `ScheduleSummary`/`ScheduleWithTarget` (`scheduleService.ts`) and `SchedulePattern`
  (`patternService.ts`) gain `overdueAfter: { amount; unit } | null` in their read
  shape.

## Frontend

- `ChoreScheduleForm.tsx` gains one optional group, independent of recurrence type
  (shown for `once` too): "Become overdue if still to-do after" — a number input plus
  a minutes/hours/days select. Empty amount means no timer, mirroring how the rest of
  the form already treats an empty required field as "not configured."
- The schedule pill (`ChoreScheduleControl.tsx`'s `RECURRENCE_SUMMARY` /
  `chore-schedule-pill`) appends the configured duration when present, e.g.
  `"Scheduled for 2026-08-25 · Overdue after 2 days"` — same pill, no second pill.
  `SchedulesPage.tsx`'s summary line gets the same treatment.
- `applyScheduleTemplate` (`ChoreScheduleForm.tsx`) pre-fills the overdue fields from
  the chosen template when present, same as every other recurrence field it already
  pre-fills.
- `PatternForm.tsx` gains the same optional group as the schedule form, and
  `buildScheduleTemplateInput` (the "save as template" path already in
  `ChoreScheduleForm.tsx`) carries the current form's overdue fields into the saved
  template.
- No live countdown UI anywhere (see Scope decisions).

## Explicitly out of scope

- A standalone overdue timer with no schedule at all (the timer always rides on an
  existing `chore_schedules` row).
- A live "time remaining" countdown or displayed exact overdue instant.
- Per-unit distinct amount bounds.
- Multiple/staged overdue thresholds (e.g. "warn at 1 day, overdue at 3 days").
- Editing an existing schedule template's overdue timer independent of a full
  rename/recreate — same "rename + delete/recreate only" limitation phase 1 already
  accepted for templates in general.
