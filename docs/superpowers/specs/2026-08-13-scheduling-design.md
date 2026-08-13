# Scheduling — design

## Purpose

Today every chore status transition (`to-do` / `complete` / `overdue`) is manually
triggered by a household member. This introduces automated triggers, in two phases:

- **Phase 1 (this spec)**: automated scheduling of the `to-do` transition — a chore
  (or one of its zone-links) can be given a one-off or recurring schedule that puts
  it back into `to-do`.
- **Phase 2 (future, not designed here)**: a rule for `to-do` → `overdue`. This
  spec's data model leaves room for it (one more nullable column on the same table)
  without a redesign, but does not build it.

Developed on branch `feat/scheduling`, cut clean from `main` with no prior scheduling
scaffolding.

## Scope decisions

Reached through discussion before this spec was written:

- Support both one-off dates and recurring cadences, unified under one schedule
  concept — not two separate features.
- Recurrence is interval-based (not full RRULE), with four concrete modes: one-off,
  every-N-days, every-N-weeks-on-selected-weekdays, every-N-months-on-day-X. This
  covers the realistic range of household chore cadences without the UI complexity
  of arbitrary iCal-style rules.
- A schedule attaches per chore-zone (or to the whole chore when it has no zones) —
  mirrors how `status` itself already splits between `chores.status` and
  `chore_zones.status`, so a chore split across rooms can have an independent cadence
  per room.
- Recurrence is calendar-anchored (fixed cadence from a start date), not tied to
  completion timestamps — predictable, and needs no completion-time tracking.
- No occurrence history — this is a stateless flip of the existing status field,
  matching the app's current simplicity (no due-dates or history exist anywhere yet).
- Recurs forever; no end-date/count field.
- Exactly one active schedule per chore/chore-zone — setting a new one replaces the
  old.
- Schedules evaluate against a new household-level timezone, not a per-user/device
  one — a schedule belongs to a chore/zone, not a device, so the existing
  per-push-subscription timezone pattern doesn't fit here.
- **Firing rule**: a due occurrence flips status to `to-do` only if the current
  status is `complete`. If currently `overdue`, it's left alone — an unresolved
  overdue chore stays visibly overdue across missed cycles rather than being silently
  cleared by the next scheduled occurrence. If already `to-do`, it's a no-op.

## Data model

New table `chore_schedules`:

- `id`
- `choreId` (FK → `chores`, cascade, nullable) — set when the schedule targets a
  zoneless chore
- `choreZoneId` (FK → `chore_zones`, cascade, nullable) — set when the schedule
  targets one specific zone-link of a chore
- exactly one of `choreId` / `choreZoneId` is set (`CHECK` constraint), with a unique
  index on each (where not null) enforcing at most one schedule per target
- `recurrenceType`: `'once' | 'every_n_days' | 'weekly' | 'monthly'`
- `startAt` (epoch ms) — anchor instant: for `once`, exactly when it fires; for
  recurring types, the first occurrence and the time-of-day other occurrences reuse
- `intervalDays` (nullable, for `every_n_days`)
- `intervalWeeks` + `weekdays` (nullable, for `weekly` — e.g. every 2 weeks on
  Mon/Thu)
- `intervalMonths` + `dayOfMonth` (nullable, for `monthly`; clamp to the last valid
  day of a shorter month, e.g. day 31 in February)
- `nextRunAt` (epoch ms, nullable, indexed) — precomputed next fire time; `null`
  means done (a fired `once`, or nothing scheduled)
- `createdAt`

`households` gains a `timezone` column (nullable IANA string), same shape and
validation as `push_subscriptions.timezone` — captured client-side from
`Intl.DateTimeFormat().resolvedOptions().timeZone` at household-creation time,
editable later by a head. Schedules with no household timezone set default to UTC.

## Scheduler mechanics

A polling scheduler evaluates `chore_schedules` on a fixed interval (reusing the
existing `dailyReminderScheduler.ts` pattern: a pure, clock-parameterized check
function wrapped in a `setInterval`, started only from the process entrypoint — never
from app construction, so tests never leak a live interval). Each due schedule
(`nextRunAt <= now`) applies the firing rule above, then recomputes `nextRunAt` for
recurring types or clears it for a fired one-off.

Computing "N days/weeks/months from now" is local-calendar arithmetic in the
household's timezone, not raw epoch-ms addition — the existing `localDateAndHour`
helper in `dailyReminderScheduler.ts` is the precedent for converting an instant to
local date/time components and back.

## API and authorization

A schedule is set/replaced/removed via endpoints mirroring the existing
status-mutation endpoints (one for a zoneless chore, one for a chore-zone link), and
is attached to a chore's existing read payload rather than fetched separately.
Creating/editing/removing a schedule is Head of Household only — the same
authorization split as creating a chore, zone, or promoting/demoting a member,
enforced through the household's shared membership-authorization logic.

## Notifications

When a scheduler-driven flip happens (`complete` → `to-do`), it's treated as a reopen
and reuses the existing reopened-notification path — same batching/dedup behavior as
a human-triggered reopen. Since there's no acting human, every assignee is notified
(the existing exclude-the-actor behavior doesn't apply to a system-triggered change).

## Frontend

- A schedule sub-form (mode selector revealing only the relevant fields per mode) is
  addable when creating a chore, and editable afterward on an existing chore/zone.
- A small indicator near a chore/zone's status badge shows its schedule when one
  exists (e.g. "Repeats every 3 days" / "Next: Aug 20").
- Household timezone is captured automatically and kept resynced, mirroring the
  existing best-effort push-timezone resync.

## Explicitly out of scope for this phase

- The `to-do` → `overdue` rule (phase 2).
- Occurrence history/streaks.
- Multiple simultaneous schedules per chore/zone.
- Recurrence end-dates/counts.
