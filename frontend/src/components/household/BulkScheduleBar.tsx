import { useState } from 'react';
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
import type { ScheduleInput } from '../../types/schedule';
import { ChoreScheduleForm } from './ChoreScheduleForm';

interface BulkScheduleBarProps {
  isHead: boolean;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedCount: number;
  patterns: SchedulePattern[];
  submitting: boolean;
  resultMessage: string | null;
  onApply: (input: ScheduleInput) => void;
  onSaveAsPattern: (input: CreatePatternInput) => void;
}

export function BulkScheduleBar({
  isHead,
  selectMode,
  onToggleSelectMode,
  selectedCount,
  patterns,
  submitting,
  resultMessage,
  onApply,
  onSaveAsPattern,
}: BulkScheduleBarProps) {
  const [applying, setApplying] = useState(false);

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
          patterns={patterns}
          submitting={submitting}
          onSave={(input) => {
            onApply(input);
            setApplying(false);
          }}
          onSaveAsPattern={onSaveAsPattern}
          onCancel={() => setApplying(false)}
        />
      )}
    </div>
  );
}
