import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPenToSquare, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../../types/scheduleTemplate';
import { ChoreScheduleForm } from './ChoreScheduleForm';

interface ChoreScheduleControlProps {
  schedule: Schedule | null;
  isHead: boolean;
  submitting: boolean;
  onSave: (input: ScheduleInput) => void;
  onRemove: () => void;
  scheduleTemplates: ScheduleTemplate[];
  onSaveAsScheduleTemplate: (input: CreateScheduleTemplateInput) => void;
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
  scheduleTemplates,
  onSaveAsScheduleTemplate,
}: ChoreScheduleControlProps) {
  const [editing, setEditing] = useState(false);

  if (!isHead && !schedule) return null;

  if (editing) {
    return (
      <ChoreScheduleForm
        schedule={schedule}
        scheduleTemplates={scheduleTemplates}
        submitting={submitting}
        onSave={(input) => {
          onSave(input);
          setEditing(false);
        }}
        onSaveAsScheduleTemplate={onSaveAsScheduleTemplate}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="chore-schedule-control">
      {schedule && <span className="chore-schedule-summary">{RECURRENCE_SUMMARY[schedule.recurrenceType](schedule)}</span>}
      {isHead && !schedule && (
        <button type="button" className="btn btn-text" onClick={() => setEditing(true)}>
          Add schedule
        </button>
      )}
      {isHead && schedule && (
        <button
          type="button"
          className="chore-schedule-icon-btn"
          onClick={() => setEditing(true)}
          aria-label="Edit schedule"
        >
          <FontAwesomeIcon icon={faPenToSquare} />
        </button>
      )}
      {isHead && schedule && (
        <button
          type="button"
          className="chore-schedule-icon-btn chore-schedule-icon-btn-remove"
          disabled={submitting}
          onClick={onRemove}
          aria-label="Remove schedule"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      )}
    </div>
  );
}
