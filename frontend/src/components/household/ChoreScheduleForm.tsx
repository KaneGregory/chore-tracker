import { useState, type FormEvent } from 'react';
import type { RecurrenceType, Schedule, ScheduleInput } from '../../types/schedule';
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
import { FormField } from '../common/FormField';
import { suggestStartDate } from '../../utils/suggestStartDate';

interface ChoreScheduleFormProps {
  schedule: Schedule | null;
  patterns: SchedulePattern[];
  submitting: boolean;
  onSave: (input: ScheduleInput) => void;
  onSaveAsPattern: (input: CreatePatternInput) => void;
  onCancel: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ChoreScheduleForm({
  schedule,
  patterns,
  submitting,
  onSave,
  onSaveAsPattern,
  onCancel,
}: ChoreScheduleFormProps) {
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(schedule?.recurrenceType ?? 'once');
  const [startDate, setStartDate] = useState(schedule?.startDate ?? '');
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '09:00');
  const [intervalDays, setIntervalDays] = useState(schedule?.intervalDays ?? 1);
  const [intervalWeeks, setIntervalWeeks] = useState(schedule?.intervalWeeks ?? 1);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(schedule?.weekdays ?? []));
  const [intervalMonths, setIntervalMonths] = useState(schedule?.intervalMonths ?? 1);
  const [saveAsPattern, setSaveAsPattern] = useState(false);
  const [patternName, setPatternName] = useState('');

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

  // Pre-fills every field a pattern carries, plus a suggested Date the user can
  // still change before saving — see suggestStartDate.ts.
  function applyPattern(patternId: string) {
    const pattern = patterns.find((candidate) => String(candidate.id) === patternId);
    if (!pattern) return;

    setRecurrenceType(pattern.recurrenceType);
    setStartTime(pattern.startTime);
    if (pattern.intervalDays !== null) setIntervalDays(pattern.intervalDays);
    if (pattern.intervalWeeks !== null) setIntervalWeeks(pattern.intervalWeeks);
    if (pattern.weekdays !== null) setWeekdays(new Set(pattern.weekdays));
    if (pattern.intervalMonths !== null) setIntervalMonths(pattern.intervalMonths);
    setStartDate(suggestStartDate(pattern));
  }

  // Mirrors scheduleService.ts's buildRowValues: dayOfMonth for a saved pattern is
  // derived from the form's current Date, the same rule the backend already applies
  // when saving the schedule itself — there is no separate dayOfMonth field/state to
  // keep in sync.
  function buildPatternInput(name: string): CreatePatternInput | null {
    switch (recurrenceType) {
      case 'every_n_days':
        return { recurrenceType, name, startTime, intervalDays };
      case 'weekly':
        return { recurrenceType, name, startTime, intervalWeeks, weekdays: [...weekdays] };
      case 'monthly':
        return {
          recurrenceType,
          name,
          startTime,
          intervalMonths,
          dayOfMonth: Number(startDate.split('-')[2]),
        };
      case 'once':
        return null;
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!startDate) return;

    switch (recurrenceType) {
      case 'once':
        onSave({ recurrenceType, startDate, startTime });
        break;
      case 'every_n_days':
        onSave({ recurrenceType, startDate, startTime, intervalDays });
        break;
      case 'weekly':
        if (weekdays.size === 0) return;
        onSave({ recurrenceType, startDate, startTime, intervalWeeks, weekdays: [...weekdays] });
        break;
      case 'monthly':
        onSave({ recurrenceType, startDate, startTime, intervalMonths });
        break;
    }

    const trimmedName = patternName.trim();
    if (saveAsPattern && trimmedName) {
      const patternInput = buildPatternInput(trimmedName);
      if (patternInput) onSaveAsPattern(patternInput);
    }
  }

  return (
    <form className="chore-schedule-form" onSubmit={handleSubmit}>
      {patterns.length > 0 && (
        <label className="schedule-field">
          Use a pattern
          <select defaultValue="" onChange={(event) => applyPattern(event.target.value)}>
            <option value="" disabled>
              Choose a saved pattern…
            </option>
            {patterns.map((pattern) => (
              <option key={pattern.id} value={pattern.id}>
                {pattern.name}
              </option>
            ))}
          </select>
        </label>
      )}

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

      <FormField
        label={recurrenceType === 'once' ? 'Date' : 'Start date'}
        name="scheduleStartDate"
        type="date"
        value={startDate}
        onChange={setStartDate}
        required
      />

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

      <FormField label="At" name="scheduleStartTime" type="time" value={startTime} onChange={setStartTime} required />

      {recurrenceType !== 'once' && (
        <label className="schedule-field schedule-save-as-pattern">
          <span>
            <input
              type="checkbox"
              checked={saveAsPattern}
              onChange={(event) => setSaveAsPattern(event.target.checked)}
            />
            Save as a reusable pattern
          </span>
          {saveAsPattern && (
            <input
              type="text"
              placeholder="Pattern name"
              value={patternName}
              onChange={(event) => setPatternName(event.target.value)}
              required
            />
          )}
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
