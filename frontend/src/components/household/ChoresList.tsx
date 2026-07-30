import type { Chore } from '../../types/chore';
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
}

export function ChoresList({
  chores,
  zoneNameById,
  members,
  currentUserId,
  isHead,
  assigningKey,
  onAssign,
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
        />
      ))}
    </ul>
  );
}
