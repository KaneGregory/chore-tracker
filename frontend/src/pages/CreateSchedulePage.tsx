import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { ScheduleTemplateForm } from '../components/household/ScheduleTemplateForm';
import { ErrorBanner } from '../components/common/ErrorBanner';
import * as scheduleTemplateApi from '../api/scheduleTemplateApi';
import { ApiError } from '../api/httpClient';
import type { CreateScheduleTemplateInput } from '../types/scheduleTemplate';

export function CreateSchedulePage() {
  const { state } = useAuth();
  const household = state.status === 'authenticated' ? state.households[0] : undefined;
  const householdId = household?.id;
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(input: CreateScheduleTemplateInput) {
    if (!householdId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await scheduleTemplateApi.createScheduleTemplate(householdId, input);
      navigate('/schedules');
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not save that schedule.');
      setSubmitting(false);
    }
  }

  if (state.status === 'loading') return null;
  if (!household || household.role !== 'head') {
    return <Navigate to="/schedules" replace />;
  }

  return (
    <div className="card">
      <h1>New schedule</h1>
      <p className="card-eyebrow">For {household.name}</p>
      <ErrorBanner message={submitError} />
      <ScheduleTemplateForm submitting={submitting} onSubmit={(input) => void handleSubmit(input)} />
      <p className="card-footer">
        <Link to="/schedules">Cancel</Link>
      </p>
    </div>
  );
}
