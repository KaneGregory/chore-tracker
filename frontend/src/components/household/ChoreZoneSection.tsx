import { useState } from 'react';
import type { ChoreAssignment, ChoreZoneStatus, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { AssignmentChips } from './AssignmentChips';
import { CHORE_STATUS_LABEL } from '../../utils/choreStatus';

interface ChoreZoneSectionProps {
  choreId: number;
  zone: ChoreZoneStatus;
  zoneName: string;
  assignments: ChoreAssignment[];
  members: HouseholdMember[];
  currentUserId: number;
  isHead: boolean;
  assigningKey: string | null;
  onAssign: (choreId: number, userId: number, zoneId: number | null) => void;
  unassigningId: number | null;
  onUnassign: (choreId: number, assignmentId: number) => void;
  statusUpdatingKey: string | null;
  onSetStatus: (choreId: number, zoneId: number | null, status: SettableChoreStatus) => void;
}

export function ChoreZoneSection({
  choreId,
  zone,
  zoneName,
  assignments,
  members,
  currentUserId,
  isHead,
  assigningKey,
  onAssign,
  unassigningId,
  onUnassign,
  statusUpdatingKey,
  onSetStatus,
}: ChoreZoneSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = zone.status === 'complete';
  const isUpdatingStatus = statusUpdatingKey === `${choreId}:${zone.zoneId}`;

  return (
    <li className={`chore-zone-section status-${zone.status}`}>
      <button
        type="button"
        className="chore-zone-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="chore-zone-heading">
          <span className="chore-zone-name">{zoneName}</span>
          {expanded && (
            <span className={`chore-status-badge chore-status-${zone.status}`}>
              {CHORE_STATUS_LABEL[zone.status]}
            </span>
          )}
        </span>
        {!expanded && (
          <span className="chore-zone-summary">
            {assignments.length > 0 && (
              <AssignmentChips
                choreId={choreId}
                zoneId={zone.zoneId}
                assignments={assignments}
                members={members}
                currentUserId={currentUserId}
                isHead={isHead}
                assigningKey={assigningKey}
                onAssign={onAssign}
                unassigningId={unassigningId}
                onUnassign={onUnassign}
                readOnly
              />
            )}
            <span
              className={`status-dot status-dot-${zone.status}`}
              role="img"
              aria-label={CHORE_STATUS_LABEL[zone.status]}
              title={CHORE_STATUS_LABEL[zone.status]}
            />
          </span>
        )}
        <span className="chore-zone-caret" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <div className="chore-zone-body">
          <AssignmentChips
            choreId={choreId}
            zoneId={zone.zoneId}
            assignments={assignments}
            members={members}
            currentUserId={currentUserId}
            isHead={isHead}
            assigningKey={assigningKey}
            onAssign={onAssign}
            unassigningId={unassigningId}
            onUnassign={onUnassign}
          />
          <button
            type="button"
            className="btn btn-pill-outline"
            disabled={isUpdatingStatus}
            onClick={() => onSetStatus(choreId, zone.zoneId, isComplete ? 'to-do' : 'complete')}
          >
            {isUpdatingStatus ? 'Updating…' : isComplete ? 'Mark as to-do' : 'Mark complete'}
          </button>
        </div>
      )}
    </li>
  );
}
