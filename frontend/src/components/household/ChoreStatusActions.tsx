import type { ChoreStatus, SettableChoreStatus } from '../../types/chore';

interface ChoreStatusActionsProps {
  status: ChoreStatus;
  isHead: boolean;
  disabled: boolean;
  onSetStatus: (status: SettableChoreStatus) => void;
  className?: string;
}

export function ChoreStatusActions({
  status,
  isHead,
  disabled,
  onSetStatus,
  className,
}: ChoreStatusActionsProps) {
  return (
    <div className={className ? `chore-status-actions ${className}` : 'chore-status-actions'}>
      {status === 'complete' ? (
        <button
          type="button"
          className="btn btn-pill-outline"
          disabled={disabled}
          onClick={() => onSetStatus('to-do')}
        >
          {disabled ? 'Updating…' : 'Mark as to-do'}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-pill-outline"
          disabled={disabled}
          onClick={() => onSetStatus('complete')}
        >
          {disabled ? 'Updating…' : 'Mark complete'}
        </button>
      )}
      {isHead && status === 'to-do' && (
        <button
          type="button"
          className="btn btn-pill-outline"
          disabled={disabled}
          onClick={() => onSetStatus('overdue')}
        >
          {disabled ? 'Updating…' : 'Mark overdue'}
        </button>
      )}
    </div>
  );
}
