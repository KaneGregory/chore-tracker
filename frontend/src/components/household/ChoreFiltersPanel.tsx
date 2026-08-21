import type { ChoreFilter, ChoreGroupBy, ChoreStatus } from '../../types/chore';
import type { HouseholdMember } from '../../types/auth';
import { CHORE_STATUSES, CHORE_STATUS_LABEL } from '../../utils/choreStatus';
import { ChoreFilterSelect } from './ChoreFilterSelect';
import { Modal } from '../common/Modal';

interface ChoreFiltersPanelProps {
  groupBy: ChoreGroupBy;
  onGroupByChange: (groupBy: ChoreGroupBy) => void;
  statuses: Set<ChoreStatus>;
  onStatusesChange: (statuses: Set<ChoreStatus>) => void;
  filter: ChoreFilter;
  onFilterChange: (filter: ChoreFilter) => void;
  isHead: boolean;
  members: HouseholdMember[];
  currentUserId: number;
  onClose: () => void;
}

export function ChoreFiltersPanel({
  groupBy,
  onGroupByChange,
  statuses,
  onStatusesChange,
  filter,
  onFilterChange,
  isHead,
  members,
  currentUserId,
  onClose,
}: ChoreFiltersPanelProps) {
  function toggleStatus(status: ChoreStatus) {
    const next = new Set(statuses);
    if (next.has(status)) {
      next.delete(status);
    } else {
      next.add(status);
    }
    onStatusesChange(next);
  }

  return (
    <Modal title="Filters" onClose={onClose}>
      <div className="chore-filters-panel">
        <div className="chore-filters-section">
          <span className="chore-filters-section-label">Group by</span>
          <div className="chore-filters-groupby">
            <button
              type="button"
              className="btn btn-pill-outline"
              aria-pressed={groupBy === 'chore'}
              onClick={() => onGroupByChange('chore')}
            >
              By Chore
            </button>
            <button
              type="button"
              className="btn btn-pill-outline"
              aria-pressed={groupBy === 'zone'}
              onClick={() => onGroupByChange('zone')}
            >
              By Zone
            </button>
          </div>
        </div>
        <fieldset className="chore-filters-section chore-filters-fieldset">
          <legend className="chore-filters-section-label">Status</legend>
          {CHORE_STATUSES.map((status) => (
            <label className="chore-filters-status-option" key={status}>
              <input type="checkbox" checked={statuses.has(status)} onChange={() => toggleStatus(status)} />
              <span className={`status-dot status-dot-${status}`} aria-hidden="true" />
              {CHORE_STATUS_LABEL[status]}
            </label>
          ))}
        </fieldset>
        <div className="chore-filters-section">
          <span className="chore-filters-section-label">Assignee</span>
          <ChoreFilterSelect
            value={filter}
            onChange={onFilterChange}
            isHead={isHead}
            members={members}
            currentUserId={currentUserId}
          />
        </div>
      </div>
    </Modal>
  );
}
