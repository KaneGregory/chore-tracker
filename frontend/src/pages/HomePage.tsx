import { useAuth } from '../context/AuthContext';

export function HomePage() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;

  return (
    <div>
      <h1>Welcome, {state.user.email}</h1>
      <p>
        Household{state.households.length === 1 ? '' : 's'}:{' '}
        {state.households.map((h) => h.name).join(', ')}
      </p>
    </div>
  );
}
