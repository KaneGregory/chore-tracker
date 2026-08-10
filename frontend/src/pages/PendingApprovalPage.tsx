import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

// Shown instead of the normal app for an authenticated user whose only household
// membership(s) are still 'pending' — see ProtectedRoute. There's no realtime
// update when a head resolves the application, so "Check again" just re-reads the
// session; the router falls through to the normal app once it comes back active.
export function PendingApprovalPage() {
  const { state, refresh } = useAuth();
  const [checking, setChecking] = useState(false);

  if (state.status !== 'authenticated') return null;

  const pendingHouseholds = state.households.filter((household) => household.status === 'pending');

  async function handleCheckAgain() {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="card">
      <h1>Waiting for approval</h1>
      <p className="card-eyebrow">A Head of Household needs to let you in.</p>
      <p>
        You&rsquo;ve asked to join{' '}
        {pendingHouseholds.map((household, index) => (
          <span key={household.id}>
            {index > 0 && ', '}
            <strong>{household.name}</strong>
          </span>
        ))}
        . Once a Head of Household approves you there, you&rsquo;ll see your chores here.
      </p>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={checking}
        onClick={() => void handleCheckAgain()}
      >
        {checking ? 'Checking…' : 'Check again'}
      </button>
    </div>
  );
}
