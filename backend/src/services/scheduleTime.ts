import type { RecurrenceType } from '../db/schema.js';
export type { RecurrenceType };

import type { OverdueAfterUnit } from '../db/schema.js';
export type { OverdueAfterUnit };

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export interface ScheduleRecurrence {
  recurrenceType: RecurrenceType;
  startAt: number; // epoch ms — the anchor instant (see chore_schedules.startAt's comment)
  intervalDays: number | null;
  intervalWeeks: number | null;
  weekdays: number[] | null;
  intervalMonths: number | null;
  dayOfMonth: number | null;
}

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
// components. Two-pass: the first pass resolves the offset as if `guess` (a UTC
// instant with the target's wall-clock digits) were the real instant, then re-resolves
// the offset at `guess` shifted by that first offset — closer to the actual target
// instant. A single-pass guess is fine for zones near UTC, but for a zone far from UTC
// (e.g. Pacific/Auckland, UTC+13) the initial guess's local time can be ~13-14 hours
// away from the target local time, which can land the offset lookup on the wrong side
// of an annual DST transition. Still not a true fixed-point search, but accurate for
// any time outside the handful of ambiguous seconds right at a DST transition itself,
// which a fixed schedule hour essentially never lands on.
export function fromLocalDateTime(local: LocalDateTime, timeZone: string): number {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const firstOffset = offsetMs(guess, timeZone);
  return guess - offsetMs(guess - firstOffset, timeZone);
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

// Hard cap on how many cycles advanceUntilFuture will step through in one call. Two
// distinct failure modes without this: (1) a validated-but-old startDate (tightened
// in scheduleSchemas.ts, but this is the last line of defense, not the only one) can
// mean tens of thousands of legitimate steps; (2) a malformed chore_schedules row
// (e.g. recurrenceType: 'every_n_days' with intervalDays: null — nothing at the DB
// level currently enforces that pairing) makes stepOnce return the exact same instant
// forever, an infinite loop rather than just a slow one. Either way, past this many
// steps something is wrong with the row, not with a legitimately-overdue schedule.
const MAX_CATCHUP_STEPS = 10_000;

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
  let steps = 0;
  while (next <= now) {
    if (++steps > MAX_CATCHUP_STEPS) {
      throw new Error(
        'Schedule advancement exceeded the maximum catch-up steps — likely a corrupted or absurdly old schedule row',
      );
    }
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
