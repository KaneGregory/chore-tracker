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
