import { useAuth } from '../context/AuthContext';

function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function HomePage() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;

  return (
    <div className="card">
      <h1>You&rsquo;re in! 🎉</h1>
      <p className="card-eyebrow">Signed in as {state.user.email}</p>
      {state.households.map((household) => (
        <div className="household-card" key={household.id}>
          <h2>{household.name}</h2>
          <div className="stamp">{formatJoinCode(household.joinCode)}</div>
          <p className="stamp-caption">Share this code so someone else can join.</p>
        </div>
      ))}
    </div>
  );
}
