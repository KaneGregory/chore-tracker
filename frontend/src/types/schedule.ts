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
