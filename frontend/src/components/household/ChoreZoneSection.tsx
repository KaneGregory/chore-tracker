import { useState } from 'react';
import type { ChoreAssignment, ChoreZoneStatus, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { AssignmentChips } from './AssignmentChips';
import { ChoreStatusActions } from './ChoreStatusActions';
import { ChoreScheduleControl } from './ChoreScheduleControl';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import type { CreatePatternInput, SchedulePattern } from '../../types/pattern';
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
  scheduleByTarget: Map<string, Schedule>;
  scheduleSubmittingKey: string | null;
  onSetSchedule: (choreId: number, zoneId: number | null, input: ScheduleInput) => void;
  onRemoveSchedule: (choreId: number, zoneId: number | null) => void;
  patterns: SchedulePattern[];
  onSaveAsPattern: (input: CreatePatternInput) => void;
  selectMode: boolean;
  selectedTargets: Set<string>;
  onToggleTarget: (choreId: number, zoneId: number | null) => void;
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
  scheduleByTarget,
  scheduleSubmittingKey,
  onSetSchedule,
  onRemoveSchedule,
  patterns,
  onSaveAsPattern,
  selectMode,
  selectedTargets,
  onToggleTarget,
}: ChoreZoneSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const isUpdatingStatus = statusUpdatingKey === `${choreId}:${zone.zoneId}`;
  const scheduleKey = `${choreId}:${zone.zoneId}`;

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
          <ChoreStatusActions
            status={zone.status}
            isHead={isHead}
            disabled={isUpdatingStatus}
            onSetStatus={(status) => onSetStatus(choreId, zone.zoneId, status)}
          />
          <div className="chore-schedule-row">
            {selectMode && (
              <label className="chore-select-checkbox">
                <input
                  type="checkbox"
                  checked={selectedTargets.has(scheduleKey)}
                  onChange={() => onToggleTarget(choreId, zone.zoneId)}
                />
              </label>
            )}
            <ChoreScheduleControl
              schedule={scheduleByTarget.get(scheduleKey) ?? null}
              patterns={patterns}
              isHead={isHead}
              submitting={scheduleSubmittingKey === scheduleKey}
              onSave={(input) => onSetSchedule(choreId, zone.zoneId, input)}
              onSaveAsPattern={onSaveAsPattern}
              onRemove={() => onRemoveSchedule(choreId, zone.zoneId)}
            />
          </div>
        </div>
      )}
    </li>
  );
}
