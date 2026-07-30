import type { Chore, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { AssignmentChips } from './AssignmentChips';
import { StatusToggle } from './StatusToggle';

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
}

const STATUS_LABEL: Record<Chore['status'], string> = {
  'to-do': 'To Do',
  complete: 'Complete',
  overdue: 'Overdue',
};

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
}: ChoreRowProps) {
  const isAssignable = chore.type === 'single-time';
  const hasZones = chore.zones.length > 0;

  function assignmentsFor(zoneId: number | null) {
    return chore.assignments.filter((assignment) => assignment.zoneId === zoneId);
  }

  return (
    <li className="chore-card">
      <div className="chore-row-main">
        <span className="chore-name">{chore.name}</span>
        <div className="chore-row-actions">
          <span className={`chore-type-badge chore-type-${chore.type}`}>
            {chore.type === 'forever' ? 'Forever' : 'Single-time'}
          </span>
          {hasZones ? (
            <span className={`chore-status-badge chore-status-${chore.status}`}>
              {STATUS_LABEL[chore.status]}
            </span>
          ) : (
            <StatusToggle
              status={chore.status}
              disabled={statusUpdatingKey === `${chore.id}:none`}
              onToggle={(status) => onSetStatus(chore.id, null, status)}
            />
          )}
          {isAssignable && (
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
          )}
        </div>
      </div>
      {hasZones && (
        <div className="zone-tags">
          {chore.zones.map((zone) => (
            <span className="zone-tag" key={zone.zoneId}>
              {zoneNameById.get(zone.zoneId) ?? 'Unknown zone'}
              <StatusToggle
                status={zone.status}
                disabled={statusUpdatingKey === `${chore.id}:${zone.zoneId}`}
                onToggle={(status) => onSetStatus(chore.id, zone.zoneId, status)}
              />
              {isAssignable && (
                <AssignmentChips
                  choreId={chore.id}
                  zoneId={zone.zoneId}
                  assignments={assignmentsFor(zone.zoneId)}
                  members={members}
                  currentUserId={currentUserId}
                  isHead={isHead}
                  assigningKey={assigningKey}
                  onAssign={onAssign}
                  unassigningId={unassigningId}
                  onUnassign={onUnassign}
                />
              )}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
