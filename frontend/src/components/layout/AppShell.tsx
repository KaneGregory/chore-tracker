import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { UserMenu } from './UserMenu';

export function AppShell({ children }: { children: ReactNode }) {
  const { state } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <span className="logo">
          <span className="logo-mark" aria-hidden="true">
            ✓
          </span>
          Chores
        </span>
        {state.status === 'authenticated' && (
          <div className="user-chip">
            <span>{state.user.email}</span>
            <UserMenu />
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}
