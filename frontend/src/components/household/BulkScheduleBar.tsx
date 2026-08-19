import { useLayoutEffect, useRef, useState } from 'react';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../../types/scheduleTemplate';
import type { ScheduleInput } from '../../types/schedule';
import { ChoreScheduleForm } from './ChoreScheduleForm';

interface BulkScheduleBarProps {
  isHead: boolean;
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
  selectedCount,
  scheduleTemplates,
  submitting,
  resultMessage,
  onApply,
  onSaveAsScheduleTemplate,
}: BulkScheduleBarProps) {
  const [applying, setApplying] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const visible = isHead && (selectedCount > 0 || resultMessage !== null);

  // The bar is `position: fixed` (see .bulk-schedule-bar in index.css), so it never
  // takes up space in the page's own layout — without this, it would sit on top of
  // whatever content happens to be scrolled to the bottom of the page rather than
  // pushing it into view. Mirroring its live height into a CSS variable lets #root
  // reserve exactly that much extra bottom padding, so the page's own scroll range
  // always has room for it. Depends only on `visible`, not on `applying`/
  // `selectedCount`/etc: the ResizeObserver below already reacts to size changes on
  // the same element (e.g. the form expanding), so re-running the effect for those
  // would just attach a second, redundant observer.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = barRef.current;
    if (!visible || !el) {
      root.style.setProperty('--bulk-bar-height', '0px');
      return;
    }
    const updateHeight = () => root.style.setProperty('--bulk-bar-height', `${el.offsetHeight}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty('--bulk-bar-height', '0px');
    };
  }, [visible]);

  async function handleApply(input: ScheduleInput) {
    await onApply(input);
    setApplying(false);
  }

  if (!visible) return null;

  return (
    <div className="bulk-schedule-bar" ref={barRef}>
      {selectedCount > 0 && !applying && (
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
