import { useState } from 'react';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import { ChoreScheduleForm } from './ChoreScheduleForm';

interface ChoreScheduleControlProps {
  schedule: Schedule | null;
  isHead: boolean;
  submitting: boolean;
  onSave: (input: ScheduleInput) => void;
  onRemove: () => void;
}

const RECURRENCE_SUMMARY: Record<Schedule['recurrenceType'], (schedule: Schedule) => string> = {
  once: (schedule) => `Scheduled for ${schedule.startDate}`,
  every_n_days: (schedule) => `Repeats every ${schedule.intervalDays} day(s)`,
  weekly: (schedule) => `Repeats every ${schedule.intervalWeeks} week(s)`,
  monthly: (schedule) => `Repeats every ${schedule.intervalMonths} month(s)`,
};

export function ChoreScheduleControl({
  schedule,
  isHead,
  submitting,
  onSave,
  onRemove,
}: ChoreScheduleControlProps) {
  const [editing, setEditing] = useState(false);

  if (!isHead && !schedule) return null;

  if (editing) {
    return (
      <ChoreScheduleForm
        schedule={schedule}
        submitting={submitting}
        onSave={(input) => {
          onSave(input);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="chore-schedule-control">
      {schedule && <span className="chore-schedule-summary">{RECURRENCE_SUMMARY[schedule.recurrenceType](schedule)}</span>}
      {isHead && (
        <button type="button" className="btn btn-text" onClick={() => setEditing(true)}>
          {schedule ? 'Edit schedule' : 'Add schedule'}
        </button>
      )}
      {isHead && schedule && (
        <button type="button" className="btn btn-text" disabled={submitting} onClick={onRemove}>
          Remove schedule
        </button>
      )}
    </div>
  );
}
