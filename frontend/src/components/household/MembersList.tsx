import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCrown } from '@fortawesome/free-solid-svg-icons';
import type { HouseholdMember } from '../../types/auth';

interface MembersListProps {
  members: HouseholdMember[];
  currentUserId: number;
  currentUserIsHead: boolean;
  promotingId: number | null;
  onPromote: (userId: number) => void;
}

export function MembersList({
  members,
  currentUserId,
  currentUserIsHead,
  promotingId,
  onPromote,
}: MembersListProps) {
  return (
    <ul className="members-list">
      {members.map((member) => (
        <li className="member-row" key={member.id}>
          <span>
            {member.username}
            {member.id === currentUserId && <span className="member-you"> (you)</span>}
          </span>
          {member.role === 'head' ? (
            <span className="role-badge">
              <FontAwesomeIcon className="role-badge-icon" icon={faCrown} aria-hidden="true" />{' '}
              Head of Household
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
