import { useEffect, useRef, useState } from 'react';
import type { Chore, ChoreStatus, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { AssignmentChips } from './AssignmentChips';
import { ChoreStatusActions } from './ChoreStatusActions';
import { ChoreScheduleControl } from './ChoreScheduleControl';
import { ChoreZoneSection } from './ChoreZoneSection';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../../types/scheduleTemplate';
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
  scheduleTemplates: ScheduleTemplate[];
  onSaveAsScheduleTemplate: (input: CreateScheduleTemplateInput) => void;
  selectedTargets: Set<string>;
  onToggleTarget: (choreId: number, zoneId: number | null) => void;
  onSetZoneGroupSelected: (choreId: number, zoneIds: number[], selected: boolean) => void;
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
  scheduleTemplates,
  onSaveAsScheduleTemplate,
  selectedTargets,
  onToggleTarget,
  onSetZoneGroupSelected,
}: ChoreRowProps) {
  const hasZones = chore.zones.length > 0;
  const visibleZones = visibleZoneIds
    ? chore.zones.filter((zone) => visibleZoneIds.includes(zone.zoneId))
    : chore.zones;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const isRemoving = removingChoreId === chore.id;
  const isUpdatingStatus = statusUpdatingKey === `${chore.id}:none`;
  const scheduleKey = `${chore.id}:none`;

  const visibleZoneIdList = visibleZones.map((zone) => zone.zoneId);
  const selectedZoneCount = visibleZoneIdList.filter((zoneId) =>
    selectedTargets.has(`${chore.id}:${zoneId}`),
  ).length;
  const allZonesSelected = visibleZoneIdList.length > 0 && selectedZoneCount === visibleZoneIdList.length;
  const someZonesSelected = selectedZoneCount > 0 && !allZonesSelected;

  const groupCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (groupCheckboxRef.current) {
      groupCheckboxRef.current.indeterminate = someZonesSelected;
    }
  }, [someZonesSelected]);

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
      <div className="chore-row-header">
        {isHead && !hasZones && (
          <label className="chore-select-checkbox">
            <input
              type="checkbox"
              checked={selectedTargets.has(scheduleKey)}
              onChange={() => onToggleTarget(chore.id, null)}
              aria-label={`Select ${chore.name}`}
            />
          </label>
        )}
        {isHead && hasZones && (
          <label className="chore-select-checkbox">
            <input
              type="checkbox"
              ref={groupCheckboxRef}
              checked={allZonesSelected}
              onChange={() => onSetZoneGroupSelected(chore.id, visibleZoneIdList, !allZonesSelected)}
              aria-label={`Select all zones for ${chore.name}`}
            />
          </label>
        )}
        <div className="chore-row-main">
          <span className="chore-name">{chore.name}</span>
          <span className={`chore-status-badge chore-status-${displayStatus}`}>
            {CHORE_STATUS_LABEL[displayStatus]}
          </span>
        </div>
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
        <div className="chore-schedule-row">
          <ChoreScheduleControl
            schedule={scheduleByTarget.get(scheduleKey) ?? null}
            scheduleTemplates={scheduleTemplates}
            isHead={isHead}
            submitting={scheduleSubmittingKey === scheduleKey}
            onSave={(input) => onSetSchedule(chore.id, null, input)}
            onSaveAsScheduleTemplate={onSaveAsScheduleTemplate}
            onRemove={() => onRemoveSchedule(chore.id, null)}
          />
        </div>
      )}
      {!hasZones && (
        <ChoreStatusActions
          status={displayStatus}
          isHead={isHead}
          disabled={isUpdatingStatus}
          onSetStatus={(status) => onSetStatus(chore.id, null, status)}
          className="chore-status-row"
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
              scheduleTemplates={scheduleTemplates}
              onSaveAsScheduleTemplate={onSaveAsScheduleTemplate}
              selectedTargets={selectedTargets}
              onToggleTarget={onToggleTarget}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
