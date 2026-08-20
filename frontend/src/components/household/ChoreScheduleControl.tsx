import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarPlus } from '@fortawesome/free-solid-svg-icons';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../../types/scheduleTemplate';
import { formatWeekdays } from '../../utils/weekdayLabels';
import { Modal } from '../common/Modal';
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
  weekly: (schedule) =>
    `Repeats every ${schedule.intervalWeeks} week(s) on ${formatWeekdays(schedule.weekdays)}`,
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

  if (editing) {
    return (
      <Modal title={schedule ? 'Edit Schedule' : 'Add Schedule'} onClose={() => setEditing(false)}>
        <ChoreScheduleForm
          schedule={schedule}
          scheduleTemplates={scheduleTemplates}
          submitting={submitting}
          hasExistingSchedule={schedule !== null}
          onSave={(input) => {
            onSave(input);
            setEditing(false);
          }}
          onSaveAsScheduleTemplate={onSaveAsScheduleTemplate}
          onCancel={() => setEditing(false)}
        />
      </Modal>
    );
  }

  return (
    <div className="chore-schedule-control">
      {schedule ? (
        <span className="chore-schedule-pill">
          {RECURRENCE_SUMMARY[schedule.recurrenceType](schedule)}
          {isHead && (
            <button
              type="button"
              className="chip-remove"
              disabled={submitting}
              onClick={onRemove}
              aria-label="Remove schedule"
            >
              ×
            </button>
          )}
        </span>
      ) : (
        <span className="chore-schedule-summary">No schedule</span>
      )}
      {isHead && (
        <button
          type="button"
          className="assign-add-btn"
          onClick={() => setEditing(true)}
          aria-label={schedule ? 'Edit schedule' : 'Add schedule'}
        >
          <FontAwesomeIcon icon={faCalendarPlus} />
        </button>
      )}
    </div>
  );
}
