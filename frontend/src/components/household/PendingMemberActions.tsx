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

type Mode = 'idle' | 'choosing' | 'assigning' | 'declining';

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

  function handleConfirm() {
    // Nothing to choose between if there's no account-less member they could be —
    // confirming just makes them a normal new member.
    if (accountLessMembers.length === 0) {
      onApprove(pendingUserId);
    } else {
      setMode('choosing');
    }
  }

  if (mode === 'choosing') {
    return (
      <div className="zone-inline-form">
        <span>New member, or someone already in the household?</span>
        <button
          type="button"
          className="btn btn-pill-outline"
          disabled={busy}
          onClick={() => onApprove(pendingUserId)}
        >
          {isApproving ? 'Confirming…' : 'New member'}
        </button>
        <button
          type="button"
          className="btn btn-pill-outline"
          disabled={busy}
          onClick={() => setMode('assigning')}
        >
          Existing member
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
            Which one?
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
          {isAssigning ? 'Confirming…' : 'Confirm'}
        </button>
        <button
          type="button"
          className="btn btn-text"
          disabled={busy}
          onClick={() => setMode('choosing')}
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
        onClick={handleConfirm}
      >
        {isApproving ? 'Confirming…' : 'Confirm'}
      </button>
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
