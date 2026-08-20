import { useState, type FormEvent } from 'react';
import type { CreateScheduleTemplateInput, ScheduleTemplateRecurrenceType } from '../../types/scheduleTemplate';
import type { OverdueAfterUnit } from '../../types/schedule';
import { FormField } from '../common/FormField';

interface ScheduleTemplateFormProps {
  submitting: boolean;
  onSubmit: (input: CreateScheduleTemplateInput) => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ScheduleTemplateForm({ submitting, onSubmit }: ScheduleTemplateFormProps) {
  const [name, setName] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<ScheduleTemplateRecurrenceType>('every_n_days');
  const [startTime, setStartTime] = useState('09:00');
  const [intervalDays, setIntervalDays] = useState(1);
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [intervalMonths, setIntervalMonths] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [overdueAfterAmount, setOverdueAfterAmount] = useState('');
  const [overdueAfterUnit, setOverdueAfterUnit] = useState<OverdueAfterUnit>('hours');

  function toggleWeekday(day: number) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  function buildOverdueAfter(): { amount: number; unit: OverdueAfterUnit } | undefined {
    const trimmed = overdueAfterAmount.trim();
    if (!trimmed) return undefined;
    const amount = Number(trimmed);
    if (!Number.isInteger(amount) || amount < 1) return undefined;
    return { amount, unit: overdueAfterUnit };
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const overdueAfter = buildOverdueAfter();

    switch (recurrenceType) {
      case 'every_n_days':
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalDays, overdueAfter });
        break;
      case 'weekly':
        if (weekdays.size === 0) return;
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalWeeks, weekdays: [...weekdays], overdueAfter });
        break;
      case 'monthly':
        onSubmit({ recurrenceType, name: trimmedName, startTime, intervalMonths, dayOfMonth, overdueAfter });
        break;
    }

    setName('');
  }

  return (
    <form className="create-chore-form" onSubmit={handleSubmit}>
      <FormField label="Schedule name" name="scheduleTemplateName" value={name} onChange={setName} required />

      <label className="schedule-field">
        Repeats
        <select
          value={recurrenceType}
          onChange={(event) => setRecurrenceType(event.target.value as ScheduleTemplateRecurrenceType)}
        >
          <option value="every_n_days">Every few days</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>

      {recurrenceType === 'every_n_days' && (
        <label className="schedule-field">
          Every
          <input
            type="number"
            min={1}
            max={365}
            value={intervalDays}
            onChange={(event) => setIntervalDays(Number(event.target.value))}
          />
          day(s)
        </label>
      )}

      {recurrenceType === 'weekly' && (
        <>
          <label className="schedule-field">
            Every
            <input
              type="number"
              min={1}
              max={52}
              value={intervalWeeks}
              onChange={(event) => setIntervalWeeks(Number(event.target.value))}
            />
            week(s) on
          </label>
          <div className="weekday-picker">
            {WEEKDAY_LABELS.map((label, day) => (
              <label key={day} className="weekday-picker-option">
                <input type="checkbox" checked={weekdays.has(day)} onChange={() => toggleWeekday(day)} />
                {label}
              </label>
            ))}
          </div>
        </>
      )}

      {recurrenceType === 'monthly' && (
        <>
          <label className="schedule-field">
            Every
            <input
              type="number"
              min={1}
              max={24}
              value={intervalMonths}
              onChange={(event) => setIntervalMonths(Number(event.target.value))}
            />
            month(s), on day
          </label>
          <label className="schedule-field">
            Day of month
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(Number(event.target.value))}
            />
          </label>
        </>
      )}

      <FormField label="At" name="scheduleTemplateStartTime" type="time" value={startTime} onChange={setStartTime} required />

      <label className="schedule-field">
        Become overdue if still to-do after
        <div className="overdue-after-inputs">
          <input
            type="number"
            min={1}
            max={999}
            placeholder="No timer"
            value={overdueAfterAmount}
            onChange={(event) => setOverdueAfterAmount(event.target.value)}
          />
          <select
            value={overdueAfterUnit}
            onChange={(event) => setOverdueAfterUnit(event.target.value as OverdueAfterUnit)}
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
        </div>
      </label>

      <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save schedule'}
      </button>
    </form>
  );
}
