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
}

export type CreateScheduleTemplateInput =
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
