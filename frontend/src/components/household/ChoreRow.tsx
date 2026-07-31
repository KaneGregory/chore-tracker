import { useState } from 'react';
import type { Chore, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { AssignmentChips } from './AssignmentChips';
import { ChoreZoneSection } from './ChoreZoneSection';
import { CHORE_STATUS_LABEL } from '../../utils/choreStatus';

interface ChoreRowProps {
  chore: Chore;
  zoneNameById: Map<number, string>;
  members: HouseholdMember[];
  currentUserId: number;
  isHead: boolean;
  assigningKey: string | null;
  onAssign: (choreId: number, userId: number, zoneId: number | null) => void;
  unassigningId: number | null;
  onUnassign: (choreId: number, assignmentId: number) => void;
  statusUpdatingKey: string | null;
  onSetStatus: (choreId: number, zoneId: number | null, status: SettableChoreStatus) => void;
  removingChoreId: number | null;
  onRemove: (choreId: number) => void;
}

export function ChoreRow({
  chore,
  zoneNameById,
  members,
  currentUserId,
  isHead,
  assigningKey,
  onAssign,
  unassigningId,
  onUnassign,
  statusUpdatingKey,
  onSetStatus,
  removingChoreId,
  onRemove,
}: ChoreRowProps) {
  const hasZones = chore.zones.length > 0;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const isRemoving = removingChoreId === chore.id;
  const isComplete = chore.status === 'complete';
  const isUpdatingStatus = statusUpdatingKey === `${chore.id}:none`;

  function assignmentsFor(zoneId: number | null) {
    return chore.assignments.filter((assignment) => assignment.zoneId === zoneId);
  }

  return (
    <li className={`chore-card status-${chore.status}`}>
      {isHead && !confirmingRemove && (
        <button
          type="button"
          className="chore-remove-btn"
          onClick={() => setConfirmingRemove(true)}
          aria-label={`Remove ${chore.name}`}
        >
          ×
        </button>
      )}
      <div className="chore-row-main">
        <span className="chore-name">{chore.name}</span>
        <span className={`chore-status-badge chore-status-${chore.status}`}>
          {CHORE_STATUS_LABEL[chore.status]}
        </span>
      </div>
      {confirmingRemove && (
        <div className="zone-inline-form">
          <span>Remove this chore?</span>
          <button
            type="button"
            className="btn btn-pill-outline"
            disabled={isRemoving}
            onClick={() => {
              onRemove(chore.id);
              setConfirmingRemove(false);
            }}
          >
            {isRemoving ? 'Removing…' : 'Yes, remove'}
          </button>
          <button type="button" className="btn btn-text" onClick={() => setConfirmingRemove(false)}>
            Cancel
          </button>
        </div>
      )}
      <div className="chore-assignees">
        <AssignmentChips
          choreId={chore.id}
          zoneId={null}
          assignments={assignmentsFor(null)}
          members={members}
          currentUserId={currentUserId}
          isHead={isHead}
          assigningKey={assigningKey}
          onAssign={onAssign}
          unassigningId={unassigningId}
          onUnassign={onUnassign}
        />
      </div>
      {!hasZones && (
        <button
          type="button"
          className="btn btn-pill-outline chore-status-btn"
          disabled={isUpdatingStatus}
          onClick={() => onSetStatus(chore.id, null, isComplete ? 'to-do' : 'complete')}
        >
          {isUpdatingStatus ? 'Updating…' : isComplete ? 'Mark as to-do' : 'Mark complete'}
        </button>
      )}
      {hasZones && (
        <ul className="chore-zones">
          {chore.zones.map((zone) => (
            <ChoreZoneSection
              key={zone.zoneId}
              choreId={chore.id}
              zone={zone}
              zoneName={zoneNameById.get(zone.zoneId) ?? 'Unknown zone'}
              assignments={assignmentsFor(zone.zoneId)}
              members={members}
              currentUserId={currentUserId}
              isHead={isHead}
              assigningKey={assigningKey}
              onAssign={onAssign}
              unassigningId={unassigningId}
              onUnassign={onUnassign}
              statusUpdatingKey={statusUpdatingKey}
              onSetStatus={onSetStatus}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
