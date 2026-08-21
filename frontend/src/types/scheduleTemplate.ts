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
