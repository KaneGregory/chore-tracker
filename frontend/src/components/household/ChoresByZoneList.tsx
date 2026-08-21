import type { FilteredChore } from '../../utils/choreFilter';
import { groupByZone } from '../../utils/choreZoneGrouping';
import { ChoreRow } from './ChoreRow';
import { ZoneBucketCard } from './ZoneBucketCard';
import { ChoresEmptyState, type ChoresListSharedProps } from './ChoresList';

interface ChoresByZoneListProps extends ChoresListSharedProps {
  entries: FilteredChore[];
  allChoresCount: number;
}

export function ChoresByZoneList({
  entries,
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
  scheduleTemplates,
  onSaveAsScheduleTemplate,
  selectedTargets,
  onToggleTarget,
  onSetZoneGroupSelected,
}: ChoresByZoneListProps) {
  const { buckets, zoneless } = groupByZone(entries, zoneNameById);

  if (buckets.length === 0 && zoneless.length === 0) {
    return <ChoresEmptyState allChoresCount={allChoresCount} />;
  }

  return (
    <ul className="chores-list">
      {buckets.map((bucket) => (
        <ZoneBucketCard
          key={bucket.zoneId}
          zoneName={bucket.zoneName}
          status={bucket.status}
          entries={bucket.entries}
          members={members}
          currentUserId={currentUserId}
          isHead={isHead}
          assigningKey={assigningKey}
          onAssign={onAssign}
          unassigningId={unassigningId}
          onUnassign={onUnassign}
          statusUpdatingKey={statusUpdatingKey}
          onSetStatus={onSetStatus}
          scheduleByTarget={scheduleByTarget}
          scheduleSubmittingKey={scheduleSubmittingKey}
          onSetSchedule={onSetSchedule}
          onRemoveSchedule={onRemoveSchedule}
          scheduleTemplates={scheduleTemplates}
          onSaveAsScheduleTemplate={onSaveAsScheduleTemplate}
          selectedTargets={selectedTargets}
          onToggleTarget={onToggleTarget}
        />
      ))}
      {zoneless.length > 0 && (
        <li className="zone-bucket-divider" key="no-zone-heading">
          <h2 className="chore-name zone-bucket-title">No Zone</h2>
        </li>
      )}
      {zoneless.map(({ chore, visibleZoneIds, displayStatus }) => (
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
          scheduleTemplates={scheduleTemplates}
          onSaveAsScheduleTemplate={onSaveAsScheduleTemplate}
          selectedTargets={selectedTargets}
          onToggleTarget={onToggleTarget}
          onSetZoneGroupSelected={onSetZoneGroupSelected}
        />
      ))}
    </ul>
  );
}
