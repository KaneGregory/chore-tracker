import type { Chore } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { AssignmentChips } from './AssignmentChips';

interface ChoreRowProps {
  chore: Chore;
  zoneNameById: Map<number, string>;
  members: HouseholdMember[];
  currentUserId: number;
  isHead: boolean;
  assigningKey: string | null;
  onAssign: (choreId: number, userId: number, zoneId: number | null) => void;
}

export function ChoreRow({
  chore,
  zoneNameById,
  members,
  currentUserId,
  isHead,
  assigningKey,
  onAssign,
}: ChoreRowProps) {
  const isAssignable = chore.type === 'single-time';

  function assignmentsFor(zoneId: number | null) {
    return chore.assignments.filter((assignment) => assignment.zoneId === zoneId);
  }

  return (
    <li className="chore-row">
      <div className="chore-row-main">
        <span className="chore-name">{chore.name}</span>
        <div className="chore-row-actions">
          <span className={`chore-type-badge chore-type-${chore.type}`}>
            {chore.type === 'forever' ? 'Forever' : 'Single-time'}
          </span>
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
            />
          )}
        </div>
      </div>
      {chore.zoneIds.length > 0 && (
        <div className="zone-tags">
          {chore.zoneIds.map((zoneId) => (
            <span className="zone-tag" key={zoneId}>
              {zoneNameById.get(zoneId) ?? 'Unknown zone'}
              {isAssignable && (
                <AssignmentChips
                  choreId={chore.id}
                  zoneId={zoneId}
                  assignments={assignmentsFor(zoneId)}
                  members={members}
                  currentUserId={currentUserId}
                  isHead={isHead}
                  assigningKey={assigningKey}
                  onAssign={onAssign}
                />
              )}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
