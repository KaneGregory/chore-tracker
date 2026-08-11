import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../../context/AuthContext';
import { NotificationOptIn } from '../notifications/NotificationOptIn';

export function UserMenu() {
  const { state, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (state.status !== 'authenticated') return null;

  const household = state.households[0];

  async function handleLogout() {
    setIsOpen(false);
    await logout();
  }

  return (
    <div className="user-menu" ref={containerRef}>
      <button
        type="button"
        className="btn btn-pill-outline"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Menu"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <FontAwesomeIcon icon={faBars} />
      </button>
      {isOpen && (
        <div className="user-menu-dropdown" role="menu">
          <Link role="menuitem" to="/" onClick={() => setIsOpen(false)}>
            Chores
          </Link>
          {household && (
            <>
              <Link
                role="menuitem"
                to={`/households/${household.id}/zones`}
                onClick={() => setIsOpen(false)}
              >
                Zones
              </Link>
              <Link
                role="menuitem"
                to={`/households/${household.id}/members`}
                onClick={() => setIsOpen(false)}
              >
                Members
              </Link>
            </>
          )}
          <NotificationOptIn />
          <div className="user-menu-divider" role="separator" />
          <span className="user-menu-identity">Logged in as {state.user.email}</span>
          <button role="menuitem" type="button" onClick={() => void handleLogout()}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
