import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCrown } from '@fortawesome/free-solid-svg-icons';
import type { HouseholdMember } from '../../types/auth';
import { PendingMemberActions } from './PendingMemberActions';

interface MembersListProps {
  members: HouseholdMember[];
  currentUserId: number;
  currentUserIsHead: boolean;
  promotingId: number | null;
  onPromote: (userId: number) => void;
  demotingId: number | null;
  onDemote: (userId: number) => void;
  resolvingPendingKey: string | null;
  onApprove: (userId: number) => void;
  onDecline: (userId: number) => void;
  onAssign: (userId: number, targetMemberId: number) => void;
}

export function MembersList({
  members,
  currentUserId,
  currentUserIsHead,
  promotingId,
  onPromote,
  demotingId,
  onDemote,
  resolvingPendingKey,
  onApprove,
  onDecline,
  onAssign,
}: MembersListProps) {
  const accountLessMembers = members.filter(
    (member) => member.status === 'active' && !member.hasAccount,
  );

  return (
    <ul className="members-list">
      {members.map((member) => (
        <li className="member-row" key={member.id}>
          <span>
            {member.username}
            {member.id === currentUserId && <span className="member-you"> (you)</span>}
          </span>
          {member.status === 'pending' ? (
            <PendingMemberActions
              pendingUserId={member.id}
              accountLessMembers={accountLessMembers}
              resolvingKey={resolvingPendingKey}
              onApprove={onApprove}
              onDecline={onDecline}
              onAssign={onAssign}
            />
          ) : member.role === 'head' ? (
            <span className="member-head-actions">
              <span className="role-badge">
                <FontAwesomeIcon className="role-badge-icon" icon={faCrown} aria-hidden="true" />{' '}
                Head of Household
              </span>
              {currentUserIsHead && !member.isCreator && member.id !== currentUserId && (
                <button
                  type="button"
                  className="btn btn-pill-outline"
                  disabled={demotingId === member.id}
                  onClick={() => onDemote(member.id)}
                >
                  {demotingId === member.id ? 'Demoting…' : 'Demote'}
                </button>
              )}
            </span>
          ) : (
            currentUserIsHead && (
              <button
                type="button"
                className="btn btn-pill-outline"
                disabled={promotingId === member.id}
                onClick={() => onPromote(member.id)}
              >
                {promotingId === member.id ? 'Promoting…' : 'Promote'}
              </button>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
