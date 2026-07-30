import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ChoreAssignment } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';

interface AssignmentChipsProps {
  choreId: number;
  zoneId: number | null;
  assignments: ChoreAssignment[];
  members: HouseholdMember[];
  currentUserId: number;
  isHead: boolean;
  assigningKey: string | null;
  onAssign: (choreId: number, userId: number, zoneId: number | null) => void;
}

export function AssignmentChips({
  choreId,
  zoneId,
  assignments,
  members,
  currentUserId,
  isHead,
  assigningKey,
  onAssign,
}: AssignmentChipsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isAssigning = assigningKey === `${choreId}:${zoneId ?? 'none'}`;
  const assignedUserIds = new Set(assignments.map((assignment) => assignment.userId));
  const availableMembers = members.filter((member) => !assignedUserIds.has(member.id));
  const selfAlreadyAssigned = assignedUserIds.has(currentUserId);

  function handlePick(event: ChangeEvent<HTMLSelectElement>) {
    const userId = Number(event.target.value);
    setPickerOpen(false);
    if (userId) onAssign(choreId, userId, zoneId);
  }

  return (
    <span className="assignment-chips">
      {assignments.map((assignment) => (
        <span className="assignee-chip" key={assignment.id}>
          {assignment.userEmail}
          {assignment.userId === currentUserId ? ' (you)' : ''}
        </span>
      ))}
      {isHead ? (
        availableMembers.length > 0 &&
        (pickerOpen ? (
          <select
            className="assignment-select"
            autoFocus
            disabled={isAssigning}
            defaultValue=""
            onChange={handlePick}
            onBlur={() => setPickerOpen(false)}
          >
            <option value="" disabled>
              {isAssigning ? 'Assigning…' : 'Choose…'}
            </option>
            {availableMembers.map((member) => (
              <option value={member.id} key={member.id}>
                {member.email}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className="assign-add-btn"
            onClick={() => setPickerOpen(true)}
            aria-label="Assign someone"
          >
            +
          </button>
        ))
      ) : (
        !selfAlreadyAssigned && (
          <button
            type="button"
            className="assign-add-btn"
            disabled={isAssigning}
            onClick={() => onAssign(choreId, currentUserId, zoneId)}
            aria-label="Assign to me"
          >
            +
          </button>
        )
      )}
    </span>
  );
}
