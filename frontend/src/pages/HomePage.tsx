import { useAuth } from '../context/AuthContext';
import { HouseholdCard } from '../components/household/HouseholdCard';

export function HomePage() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;

  return (
    <div className="card">
      <h1>You&rsquo;re in! 🎉</h1>
      <p className="card-eyebrow">Signed in as {state.user.email}</p>
      {state.households.map((household) => (
        <HouseholdCard household={household} key={household.id} />
      ))}
    </div>
  );
}
