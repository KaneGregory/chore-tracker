import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { PendingApprovalPage } from '../pages/PendingApprovalPage';
import { OnboardHouseholdPage } from '../pages/OnboardHouseholdPage';

export function ProtectedRoute() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    return null;
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  // No active household yet — regardless of which page they were headed to, show
  // whichever of these two explains why, instead of a broken/empty normal app.
  const hasActiveHousehold = state.households.some((household) => household.status === 'active');
  if (!hasActiveHousehold) {
    const hasPendingHousehold = state.households.some(
      (household) => household.status === 'pending',
    );
    return hasPendingHousehold ? <PendingApprovalPage /> : <OnboardHouseholdPage />;
  }

  return <Outlet />;
}
