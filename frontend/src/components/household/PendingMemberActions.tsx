import { useState } from 'react';
import type { HouseholdMember } from '../../types/auth';

interface PendingMemberActionsProps {
  pendingUserId: number;
  // Existing members with no login of their own — candidates to merge this
  // applicant into, since they might be the same real person (see
  // householdService.assignPendingMember on the backend).
  accountLessMembers: HouseholdMember[];
  resolvingKey: string | null;
  onApprove: (userId: number) => void;
  onDecline: (userId: number) => void;
  onAssign: (userId: number, targetMemberId: number) => void;
}

type Mode = 'idle' | 'assigning' | 'declining';

export function PendingMemberActions({
  pendingUserId,
  accountLessMembers,
  resolvingKey,
  onApprove,
  onDecline,
  onAssign,
}: PendingMemberActionsProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [targetMemberId, setTargetMemberId] = useState<number | ''>('');

  const busy = resolvingKey !== null && resolvingKey.startsWith(`${pendingUserId}:`);
  const isApproving = resolvingKey === `${pendingUserId}:approve`;
  const isDeclining = resolvingKey === `${pendingUserId}:decline`;
  const isAssigning = resolvingKey === `${pendingUserId}:assign`;

  if (mode === 'assigning') {
    return (
      <div className="zone-inline-form">
        <select
          autoFocus
          value={targetMemberId}
          disabled={busy}
          onChange={(event) => setTargetMemberId(Number(event.target.value))}
        >
          <option value="" disabled>
            Assign to…
          </option>
          {accountLessMembers.map((member) => (
            <option value={member.id} key={member.id}>
              {member.username}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-pill-outline"
          disabled={busy || targetMemberId === ''}
          onClick={() => onAssign(pendingUserId, targetMemberId as number)}
        >
          {isAssigning ? 'Assigning…' : 'Confirm'}
        </button>
        <button
          type="button"
          className="btn btn-text"
          disabled={busy}
          onClick={() => setMode('idle')}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (mode === 'declining') {
    return (
      <div className="zone-inline-form">
        <span>Decline this application?</span>
        <button
          type="button"
          className="btn btn-pill-outline"
          disabled={busy}
          onClick={() => onDecline(pendingUserId)}
        >
          {isDeclining ? 'Declining…' : 'Yes, decline'}
        </button>
        <button
          type="button"
          className="btn btn-text"
          disabled={busy}
          onClick={() => setMode('idle')}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <span className="pending-member-actions">
      <span className="pending-badge">Pending approval</span>
      <button
        type="button"
        className="btn btn-pill-outline"
        disabled={busy}
        onClick={() => onApprove(pendingUserId)}
      >
        {isApproving ? 'Approving…' : 'Approve'}
      </button>
      {accountLessMembers.length > 0 && (
        <button
          type="button"
          className="btn btn-pill-outline"
          disabled={busy}
          onClick={() => setMode('assigning')}
        >
          Assign…
        </button>
      )}
      <button
        type="button"
        className="btn btn-text"
        disabled={busy}
        onClick={() => setMode('declining')}
      >
        Decline
      </button>
    </span>
  );
}
