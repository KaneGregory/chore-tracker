import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';

export function AppShell({ children }: { children: ReactNode }) {
  const { state, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <span>Chore Tracker</span>
        {state.status === 'authenticated' && (
          <div>
            <span>{state.user.email}</span>
            <button type="button" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}
