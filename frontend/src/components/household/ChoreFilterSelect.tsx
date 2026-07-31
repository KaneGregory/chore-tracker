import type { ChangeEvent } from 'react';
import type { ChoreFilter } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';

interface ChoreFilterSelectProps {
  value: ChoreFilter;
  onChange: (value: ChoreFilter) => void;
  isHead: boolean;
  members: HouseholdMember[];
  currentUserId: number;
}

function toOptionValue(filter: ChoreFilter): string {
  return filter === 'all' || filter === 'mine' ? filter : `user:${filter}`;
}

function fromOptionValue(value: string): ChoreFilter {
  if (value === 'all' || value === 'mine') return value;
  return Number(value.slice('user:'.length));
}

export function ChoreFilterSelect({
  value,
  onChange,
  isHead,
  members,
  currentUserId,
}: ChoreFilterSelectProps) {
  const otherMembers = members.filter((member) => member.id !== currentUserId);

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(fromOptionValue(event.target.value));
  }

  return (
    <select
      className="chore-filter-select"
      value={toOptionValue(value)}
      onChange={handleChange}
      aria-label="Filter chores"
    >
      <option value="all">All</option>
      <option value="mine">Mine</option>
      {isHead &&
        otherMembers.map((member) => (
          <option value={`user:${member.id}`} key={member.id}>
            {member.username}
          </option>
        ))}
    </select>
  );
}
