import type { ScheduleTemplate } from '../types/scheduleTemplate';

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
export function suggestStartDate(template: ScheduleTemplate, today: Date = new Date()): string {
  switch (template.recurrenceType) {
    case 'every_n_days':
      return formatDate(today);

    case 'weekly': {
      const weekdays = new Set(template.weekdays ?? []);
      for (let offset = 0; offset < 7; offset++) {
        const candidate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
        if (weekdays.has(candidate.getDay())) return formatDate(candidate);
      }
      // Unreachable if the template has at least one weekday (always true once
      // created — see scheduleTemplateSchemas.ts's min(1) on weekdays), kept as a
      // safe fallback rather than throwing.
      return formatDate(today);
    }

    case 'monthly': {
      const day = template.dayOfMonth ?? 1;
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      // Deliberately does NOT clamp to a short month's last day the way
      // scheduleTime.ts's real monthly stepping does — clamping here would suggest
      // e.g. Feb 28 for a "31st of every month" template, and since the eventual
      // schedule's own dayOfMonth is derived from whatever date actually gets saved
      // (see ChoreScheduleForm.tsx's buildScheduleTemplateInput / scheduleService.ts),
      // a clamped suggestion the user doesn't think to correct would permanently
      // downgrade the schedule to the 28th instead of the 31st. Searching forward to
      // the next month that actually has this day keeps the suggested date's
      // day-of-month exactly equal to the template's, always.
      for (let monthOffset = 0; monthOffset < 12; monthOffset++) {
        const monthIndex = today.getMonth() + monthOffset;
        const year = today.getFullYear() + Math.floor(monthIndex / 12);
        const zeroBasedMonth = monthIndex % 12;
        if (day > daysInMonth(year, zeroBasedMonth + 1)) continue;
        const candidate = new Date(year, zeroBasedMonth, day);
        if (candidate >= todayOnly) return formatDate(candidate);
      }
      // Unreachable for a valid dayOfMonth (1-31, enforced by
      // scheduleTemplateSchemas.ts) — within any 12 consecutive months there's always
      // at least one match. Kept as a safe fallback rather than throwing.
      return formatDate(todayOnly);
    }
  }
}
