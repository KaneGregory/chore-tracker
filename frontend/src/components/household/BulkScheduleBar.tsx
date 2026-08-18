import { useState } from 'react';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../../types/scheduleTemplate';
import type { ScheduleInput } from '../../types/schedule';
import { ChoreScheduleForm } from './ChoreScheduleForm';

interface BulkScheduleBarProps {
  isHead: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedCount: number;
  scheduleTemplates: ScheduleTemplate[];
  submitting: boolean;
  resultMessage: string | null;
  // Returns a Promise, awaited below, rather than firing-and-forgetting: the
  // inline form (and its Save/Cancel buttons, disabled via `submitting`) must stay
  // mounted until the actual batch of requests resolves. An earlier version closed
  // the form the instant onApply was called, before its requests finished — which
  // re-revealed the "Apply schedule to N selected" trigger button while the batch
  // was still in flight, letting a user fire a second overlapping batch against the
  // same targets.
  onApply: (input: ScheduleInput) => Promise<void>;
  onSaveAsScheduleTemplate: (input: CreateScheduleTemplateInput) => void;
}

export function BulkScheduleBar({
  isHead,
  selectMode,
  onToggleSelectMode,
  selectedCount,
  scheduleTemplates,
  submitting,
  resultMessage,
  onApply,
  onSaveAsScheduleTemplate,
}: BulkScheduleBarProps) {
  const [applying, setApplying] = useState(false);

  async function handleApply(input: ScheduleInput) {
    await onApply(input);
    setApplying(false);
  }

  if (!isHead) return null;

  return (
    <div className="bulk-schedule-bar">
      <button type="button" className="btn btn-pill-outline" onClick={onToggleSelectMode}>
        {selectMode ? 'Cancel' : 'Select chores'}
      </button>
      {selectMode && selectedCount > 0 && !applying && (
        <>
          <span className="bulk-schedule-count">{selectedCount} selected</span>
          <button type="button" className="btn btn-pill-outline" onClick={() => setApplying(true)}>
            Apply schedule to {selectedCount} selected
          </button>
        </>
      )}
      {resultMessage && <span className="bulk-schedule-result">{resultMessage}</span>}
      {applying && (
        <ChoreScheduleForm
          schedule={null}
          scheduleTemplates={scheduleTemplates}
          submitting={submitting}
          onSave={(input) => void handleApply(input)}
          onSaveAsScheduleTemplate={onSaveAsScheduleTemplate}
          onCancel={() => setApplying(false)}
        />
      )}
    </div>
  );
}
