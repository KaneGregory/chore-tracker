import { Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { HouseholdCard } from '../components/household/HouseholdCard';

export function HomePage() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;

  const primaryHousehold = state.households[0];

  return (
    <>
      <div className="page-header">
        <h1>Chores</h1>
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
        <HouseholdCard household={household} key={household.id} />
      ))}
    </>
  );
}
