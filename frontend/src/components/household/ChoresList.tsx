import type { SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import type { FilteredChore } from '../../utils/choreFilter';
import { ChoreRow } from './ChoreRow';

interface ChoresListProps {
  chores: FilteredChore[];
  allChoresCount: number;
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
  scheduleByTarget: Map<string, Schedule>;
  scheduleSubmittingKey: string | null;
  onSetSchedule: (choreId: number, zoneId: number | null, input: ScheduleInput) => void;
  onRemoveSchedule: (choreId: number, zoneId: number | null) => void;
}

export function ChoresList({
  chores,
  allChoresCount,
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
  scheduleByTarget,
  scheduleSubmittingKey,
  onSetSchedule,
  onRemoveSchedule,
}: ChoresListProps) {
  if (chores.length === 0) {
    return (
      <p className="chores-empty">
        {allChoresCount === 0 ? 'No chores yet.' : 'No chores match this filter.'}
      </p>
    );
  }

  return (
    <ul className="chores-list">
      {chores.map(({ chore, visibleZoneIds, displayStatus }) => (
        <ChoreRow
          key={chore.id}
          chore={chore}
          visibleZoneIds={visibleZoneIds}
          displayStatus={displayStatus}
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
          scheduleByTarget={scheduleByTarget}
          scheduleSubmittingKey={scheduleSubmittingKey}
          onSetSchedule={onSetSchedule}
          onRemoveSchedule={onRemoveSchedule}
        />
      ))}
    </ul>
  );
}
