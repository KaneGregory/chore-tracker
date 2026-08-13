import { useState } from 'react';
import type { Chore, ChoreStatus, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { AssignmentChips } from './AssignmentChips';
import { ChoreStatusActions } from './ChoreStatusActions';
import { ChoreScheduleControl } from './ChoreScheduleControl';
import { ChoreZoneSection } from './ChoreZoneSection';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import { CHORE_STATUS_LABEL } from '../../utils/choreStatus';

interface ChoreRowProps {
  chore: Chore;
  visibleZoneIds: number[] | null;
  displayStatus: ChoreStatus;
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

export function ChoreRow({
  chore,
  visibleZoneIds,
  displayStatus,
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
}: ChoreRowProps) {
  const hasZones = chore.zones.length > 0;
  const visibleZones = visibleZoneIds
    ? chore.zones.filter((zone) => visibleZoneIds.includes(zone.zoneId))
    : chore.zones;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const isRemoving = removingChoreId === chore.id;
  const isUpdatingStatus = statusUpdatingKey === `${chore.id}:none`;
  const scheduleKey = `${chore.id}:none`;

  function assignmentsFor(zoneId: number | null) {
    return chore.assignments.filter((assignment) => assignment.zoneId === zoneId);
  }

  return (
    <li className={`chore-card status-${displayStatus}`}>
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
        <span className={`chore-status-badge chore-status-${displayStatus}`}>
          {CHORE_STATUS_LABEL[displayStatus]}
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
        <ChoreStatusActions
          status={displayStatus}
          isHead={isHead}
          disabled={isUpdatingStatus}
          onSetStatus={(status) => onSetStatus(chore.id, null, status)}
          className="chore-status-row"
        />
      )}
      {!hasZones && (
        <ChoreScheduleControl
          schedule={scheduleByTarget.get(scheduleKey) ?? null}
          isHead={isHead}
          submitting={scheduleSubmittingKey === scheduleKey}
          onSave={(input) => onSetSchedule(chore.id, null, input)}
          onRemove={() => onRemoveSchedule(chore.id, null)}
        />
      )}
      {hasZones && (
        <ul className="chore-zones">
          {visibleZones.map((zone) => (
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
              scheduleByTarget={scheduleByTarget}
              scheduleSubmittingKey={scheduleSubmittingKey}
              onSetSchedule={onSetSchedule}
              onRemoveSchedule={onRemoveSchedule}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
