import { useState } from 'react';
import type { ChoreAssignment, ChoreZoneStatus, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { AssignmentChips } from './AssignmentChips';
import { ChoreStatusActions } from './ChoreStatusActions';
import { ChoreScheduleControl } from './ChoreScheduleControl';
import type { Schedule, ScheduleInput } from '../../types/schedule';
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
          <ChoreScheduleControl
            schedule={scheduleByTarget.get(scheduleKey) ?? null}
            isHead={isHead}
            submitting={scheduleSubmittingKey === scheduleKey}
            onSave={(input) => onSetSchedule(choreId, zone.zoneId, input)}
            onRemove={() => onRemoveSchedule(choreId, zone.zoneId)}
          />
        </div>
      )}
    </li>
  );
}
