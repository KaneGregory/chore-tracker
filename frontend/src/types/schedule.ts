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
