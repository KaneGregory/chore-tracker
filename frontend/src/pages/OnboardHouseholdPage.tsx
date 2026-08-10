import { useState } from 'react';
import { HouseholdChoiceForm } from '../components/auth/HouseholdChoiceForm';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { useAuth } from '../context/AuthContext';
import * as householdApi from '../api/householdApi';
import { ApiError } from '../api/httpClient';
import type { HouseholdChoice } from '../types/auth';

// Shown instead of the normal app for an authenticated user with no household of
// their own — either brand new (shouldn't normally happen, registration always
// bundles a household) or after their pending application was declined, per
// ProtectedRoute's routing.
export function OnboardHouseholdPage() {
  const { refresh } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(choice: HouseholdChoice) {
    setSubmitting(true);
    setError(null);
    try {
      await householdApi.createOrJoinHousehold(choice);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h1>Join or start a household</h1>
      <p className="card-eyebrow">Your account isn&rsquo;t in one yet.</p>
      <ErrorBanner message={error} />
      <HouseholdChoiceForm
        submitting={submitting}
        onSubmit={(choice) => void handleSubmit(choice)}
      />
    </div>
  );
}
