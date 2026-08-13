import { useState, type FormEvent } from 'react';
import type { RecurrenceType, Schedule, ScheduleInput } from '../../types/schedule';
import { FormField } from '../common/FormField';

interface ChoreScheduleFormProps {
  schedule: Schedule | null;
  submitting: boolean;
  onSave: (input: ScheduleInput) => void;
  onCancel: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ChoreScheduleForm({ schedule, submitting, onSave, onCancel }: ChoreScheduleFormProps) {
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(schedule?.recurrenceType ?? 'once');
  const [startDate, setStartDate] = useState(schedule?.startDate ?? '');
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '09:00');
  const [intervalDays, setIntervalDays] = useState(schedule?.intervalDays ?? 1);
  const [intervalWeeks, setIntervalWeeks] = useState(schedule?.intervalWeeks ?? 1);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(schedule?.weekdays ?? []));
  const [intervalMonths, setIntervalMonths] = useState(schedule?.intervalMonths ?? 1);

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

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!startDate) return;

    switch (recurrenceType) {
      case 'once':
        onSave({ recurrenceType, startDate, startTime });
        return;
      case 'every_n_days':
        onSave({ recurrenceType, startDate, startTime, intervalDays });
        return;
      case 'weekly':
        if (weekdays.size === 0) return;
        onSave({ recurrenceType, startDate, startTime, intervalWeeks, weekdays: [...weekdays] });
        return;
      case 'monthly':
        onSave({ recurrenceType, startDate, startTime, intervalMonths });
        return;
    }
  }

  return (
    <form className="chore-schedule-form" onSubmit={handleSubmit}>
      <label className="schedule-field">
        Repeats
        <select
          value={recurrenceType}
          onChange={(event) => setRecurrenceType(event.target.value as RecurrenceType)}
        >
          <option value="once">Once</option>
          <option value="every_n_days">Every few days</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>

      <FormField label="Start date" name="scheduleStartDate" type="date" value={startDate} onChange={setStartDate} required />
      <FormField label="Time" name="scheduleStartTime" type="time" value={startTime} onChange={setStartTime} required />

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
        <label className="schedule-field">
          Every
          <input
            type="number"
            min={1}
            max={24}
            value={intervalMonths}
            onChange={(event) => setIntervalMonths(Number(event.target.value))}
          />
          month(s), on the day of month above
        </label>
      )}

      <div className="schedule-form-actions">
        <button type="submit" className="btn btn-pill-outline" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save schedule'}
        </button>
        <button type="button" className="btn btn-text" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
