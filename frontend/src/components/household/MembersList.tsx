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
            {member.email}
            {member.id === currentUserId && <span className="member-you"> (you)</span>}
          </span>
          {member.role === 'head' ? (
            <span className="role-badge">
              <span aria-hidden="true">👑</span> Head of Household
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
