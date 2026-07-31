import type { Chore, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { ChoreRow } from './ChoreRow';

interface ChoresListProps {
  chores: Chore[];
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

export function ChoresList({
  chores,
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
}: ChoresListProps) {
  if (chores.length === 0) {
    return <p className="chores-empty">No chores yet.</p>;
  }

  return (
    <ul className="chores-list">
      {chores.map((chore) => (
        <ChoreRow
          key={chore.id}
          chore={chore}
          zoneNameById={zoneNameById}
          members={members}
          currentUserId={currentUserId}
          isHead={isHead}
          assigningKey={assigningKey}
          onAssign={onAssign}
          unassigningId={unassigningId}
          onUnassign={onUnassign}
          statusUpdatingKey={statusUpdatingKey}
          onSetStatus={onSetStatus}
          removingChoreId={removingChoreId}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}
