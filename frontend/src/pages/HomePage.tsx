import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFilter } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { HouseholdCard } from '../components/household/HouseholdCard';
import { ChoreFiltersPanel } from '../components/household/ChoreFiltersPanel';
import * as householdApi from '../api/householdApi';
import { CHORE_STATUSES } from '../utils/choreStatus';
import type { HouseholdMember } from '../types/auth';
import type { ChoreFilter, ChoreGroupBy, ChoreStatus } from '../types/chore';

export function HomePage() {
  const { state } = useAuth();
  const primaryHousehold = state.status === 'authenticated' ? state.households[0] : undefined;

  const primaryHouseholdId = primaryHousehold?.id;
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [filter, setFilter] = useState<ChoreFilter>('all');
  const [groupBy, setGroupBy] = useState<ChoreGroupBy>('chore');
  const [statuses, setStatuses] = useState<Set<ChoreStatus>>(() => new Set(CHORE_STATUSES));
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!primaryHouseholdId) return;
    let cancelled = false;
    householdApi
      .listMembers(primaryHouseholdId)
      .then((result) => {
        if (!cancelled) setMembers(result);
      })
      .catch(() => {
        // Only needed to populate the head's filter dropdown; not critical to viewing chores.
      });
    return () => {
      cancelled = true;
    };
  }, [primaryHouseholdId]);

  if (state.status !== 'authenticated') return null;

  const activeFilterCount =
    (filter !== 'all' ? 1 : 0) + (statuses.size < CHORE_STATUSES.length ? 1 : 0);

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">
          <h1>Chores</h1>
          {primaryHousehold && (
            <button
              type="button"
              className="chore-filters-trigger"
              onClick={() => setFiltersOpen(true)}
            >
              <FontAwesomeIcon icon={faFilter} />
              Filters
              {activeFilterCount > 0 && (
                <span className="chore-filters-count">{activeFilterCount}</span>
              )}
            </button>
          )}
        </div>
        {primaryHousehold?.role === 'head' && (
          <Link to="/chores/new" className="btn-fab" aria-label="Add chore">
            +
          </Link>
        )}
      </div>
      {primaryHousehold && filtersOpen && (
        <ChoreFiltersPanel
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          statuses={statuses}
          onStatusesChange={setStatuses}
          filter={filter}
          onFilterChange={setFilter}
          isHead={primaryHousehold.role === 'head'}
          members={members}
          currentUserId={state.user.id}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      {state.households.map((household) => (
        <HouseholdCard
          household={household}
          key={household.id}
          filter={household.id === primaryHousehold?.id ? filter : 'all'}
          statuses={household.id === primaryHousehold?.id ? statuses : new Set(CHORE_STATUSES)}
          groupBy={household.id === primaryHousehold?.id ? groupBy : 'chore'}
        />
      ))}
    </>
  );
}
