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

import { advanceUntilFuture, computeInitialNextRunAt, fromLocalDateTime } from './scheduleTime.js';
import type { ScheduleRecurrence } from './scheduleTime.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
