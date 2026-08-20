import { useState, type FormEvent } from 'react';
import type { RecurrenceType, Schedule, ScheduleInput } from '../../types/schedule';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../../types/scheduleTemplate';
import { FormField } from '../common/FormField';
import { suggestStartDate } from '../../utils/suggestStartDate';

interface ChoreScheduleFormProps {
  schedule: Schedule | null;
  scheduleTemplates: ScheduleTemplate[];
  submitting: boolean;
  // Whether saving here would silently overwrite a schedule that already exists —
  // either this exact target's own schedule (ChoreScheduleControl.tsx) or, in a
  // bulk-apply, any one of the selected targets' schedules (BulkScheduleBar.tsx).
  // Shown as an upfront warning (see the banner below) rather than a confirm-on-
  // submit step, so the user sees it before filling in the rest of the form, not
  // after.
  hasExistingSchedule: boolean;
  onSave: (input: ScheduleInput) => void;
  onSaveAsScheduleTemplate: (input: CreateScheduleTemplateInput) => void;
  onCancel: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ChoreScheduleForm({
  schedule,
  scheduleTemplates,
  submitting,
  hasExistingSchedule,
  onSave,
  onSaveAsScheduleTemplate,
  onCancel,
}: ChoreScheduleFormProps) {
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(schedule?.recurrenceType ?? 'once');
  const [startDate, setStartDate] = useState(schedule?.startDate ?? '');
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '09:00');
  const [intervalDays, setIntervalDays] = useState(schedule?.intervalDays ?? 1);
  const [intervalWeeks, setIntervalWeeks] = useState(schedule?.intervalWeeks ?? 1);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(schedule?.weekdays ?? []));
  const [intervalMonths, setIntervalMonths] = useState(schedule?.intervalMonths ?? 1);
  const [saveAsScheduleTemplate, setSaveAsScheduleTemplate] = useState(false);
  const [scheduleTemplateName, setScheduleTemplateName] = useState('');

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

  // Pre-fills every field a schedule template carries, plus a suggested Date the
  // user can still change before saving — see suggestStartDate.ts.
  function applyScheduleTemplate(scheduleTemplateId: string) {
    const template = scheduleTemplates.find((candidate) => String(candidate.id) === scheduleTemplateId);
    if (!template) return;

    setRecurrenceType(template.recurrenceType);
    setStartTime(template.startTime);
    if (template.intervalDays !== null) setIntervalDays(template.intervalDays);
    if (template.intervalWeeks !== null) setIntervalWeeks(template.intervalWeeks);
    if (template.weekdays !== null) setWeekdays(new Set(template.weekdays));
    if (template.intervalMonths !== null) setIntervalMonths(template.intervalMonths);
    setStartDate(suggestStartDate(template));
  }

  // Mirrors scheduleService.ts's buildRowValues: dayOfMonth for a saved schedule
  // template is derived from the form's current Date, the same rule the backend
  // already applies when saving the schedule itself — there is no separate
  // dayOfMonth field/state to keep in sync.
  function buildScheduleTemplateInput(name: string): CreateScheduleTemplateInput | null {
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

  function buildScheduleInput(): ScheduleInput | undefined {
    if (!startDate) return undefined;

    switch (recurrenceType) {
      case 'once':
        return { recurrenceType, startDate, startTime };
      case 'every_n_days':
        return { recurrenceType, startDate, startTime, intervalDays };
      case 'weekly':
        if (weekdays.size === 0) return undefined;
        return { recurrenceType, startDate, startTime, intervalWeeks, weekdays: [...weekdays] };
      case 'monthly':
        return { recurrenceType, startDate, startTime, intervalMonths };
    }
  }

  function finalizeSave(input: ScheduleInput) {
    onSave(input);

    const trimmedName = scheduleTemplateName.trim();
    if (saveAsScheduleTemplate && trimmedName) {
      const scheduleTemplateInput = buildScheduleTemplateInput(trimmedName);
      if (scheduleTemplateInput) onSaveAsScheduleTemplate(scheduleTemplateInput);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const input = buildScheduleInput();
    if (!input) return;
    finalizeSave(input);
  }

  return (
    <form className="chore-schedule-form" onSubmit={handleSubmit}>
      {hasExistingSchedule && (
        <div className="schedule-replace-warning" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>This will replace the existing schedule(s).</span>
        </div>
      )}

      {scheduleTemplates.length > 0 && (
        <label className="schedule-field">
          Use a saved schedule
          <select defaultValue="" onChange={(event) => applyScheduleTemplate(event.target.value)}>
            <option value="" disabled>
              Choose a saved schedule…
            </option>
            {scheduleTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
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
        <label className="schedule-field schedule-save-as-template">
          <span>
            <input
              type="checkbox"
              checked={saveAsScheduleTemplate}
              onChange={(event) => setSaveAsScheduleTemplate(event.target.checked)}
            />
            Save as a reusable schedule
          </span>
          {saveAsScheduleTemplate && (
            <input
              type="text"
              placeholder="Schedule name"
              value={scheduleTemplateName}
              onChange={(event) => setScheduleTemplateName(event.target.value)}
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
