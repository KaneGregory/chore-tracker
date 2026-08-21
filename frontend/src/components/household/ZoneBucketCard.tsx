import type { ChoreStatus, SettableChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import type { Schedule, ScheduleInput } from '../../types/schedule';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../../types/scheduleTemplate';
import type { ZoneChoreEntry } from '../../utils/choreZoneGrouping';
import { ChoreZoneSection } from './ChoreZoneSection';

interface ZoneBucketCardProps {
  zoneName: string;
  status: ChoreStatus;
  entries: ZoneChoreEntry[];
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
  scheduleTemplates: ScheduleTemplate[];
  onSaveAsScheduleTemplate: (input: CreateScheduleTemplateInput) => void;
  selectedTargets: Set<string>;
  onToggleTarget: (choreId: number, zoneId: number | null) => void;
}

// One zone's bucket in the "group by zone" view: a chore-card-styled container
// listing every chore linked to this zone. Each row reuses ChoreZoneSection
// unmodified — its zoneName prop is repurposed here to show the chore's name, since
// the zone itself is already named by this card's heading and each row now
// represents a different chore within that one zone.
export function ZoneBucketCard({
  zoneName,
  status,
  entries,
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
  scheduleTemplates,
  onSaveAsScheduleTemplate,
  selectedTargets,
  onToggleTarget,
}: ZoneBucketCardProps) {
  return (
    <li className={`chore-card zone-bucket-card status-${status}`}>
      <h2 className="chore-name zone-bucket-title">{zoneName}</h2>
      <ul className="chore-zones">
        {entries.map(({ chore, zoneStatus }) => (
          <ChoreZoneSection
            key={chore.id}
            choreId={chore.id}
            zone={zoneStatus}
            zoneName={chore.name}
            assignments={chore.assignments.filter((assignment) => assignment.zoneId === zoneStatus.zoneId)}
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
    </li>
  );
}
