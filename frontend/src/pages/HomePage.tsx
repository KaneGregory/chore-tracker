import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { HouseholdCard } from '../components/household/HouseholdCard';
import { ChoreFilterSelect } from '../components/household/ChoreFilterSelect';
import * as householdApi from '../api/householdApi';
import type { HouseholdMember } from '../types/auth';
import type { ChoreFilter } from '../types/chore';

export function HomePage() {
  const { state } = useAuth();
  const primaryHousehold = state.status === 'authenticated' ? state.households[0] : undefined;

  const primaryHouseholdId = primaryHousehold?.id;
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [filter, setFilter] = useState<ChoreFilter>('all');

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

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">
          <h1>Chores</h1>
          {primaryHousehold && (
            <ChoreFilterSelect
              value={filter}
              onChange={setFilter}
              isHead={primaryHousehold.role === 'head'}
              members={members}
              currentUserId={state.user.id}
            />
          )}
        </div>
        {primaryHousehold?.role === 'head' && (
          <Link
            to={`/households/${primaryHousehold.id}/chores/new`}
            className="btn-fab"
            aria-label="Add chore"
          >
            +
          </Link>
        )}
      </div>
      {state.households.map((household) => (
        <HouseholdCard
          household={household}
          key={household.id}
          filter={household.id === primaryHousehold?.id ? filter : 'all'}
        />
      ))}
    </>
  );
}
