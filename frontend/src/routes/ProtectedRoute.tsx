import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return null;
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
