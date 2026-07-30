import type { ChoreStatus, SettableChoreStatus } from '../../types/chore';

interface StatusToggleProps {
  status: ChoreStatus;
  disabled: boolean;
  onToggle: (nextStatus: SettableChoreStatus) => void;
}

export function StatusToggle({ status, disabled, onToggle }: StatusToggleProps) {
  const isComplete = status === 'complete';

  return (
    <label className="status-toggle">
      <input
        type="checkbox"
        checked={isComplete}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked ? 'complete' : 'to-do')}
      />
      <span className="status-toggle-label">{isComplete ? 'Complete' : 'To do'}</span>
    </label>
  );
}
