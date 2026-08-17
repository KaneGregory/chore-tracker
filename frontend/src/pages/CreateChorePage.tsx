import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { CreateChoreForm } from '../components/household/CreateChoreForm';
import { ErrorBanner } from '../components/common/ErrorBanner';
import * as zoneApi from '../api/zoneApi';
import * as choreApi from '../api/choreApi';
import { ApiError } from '../api/httpClient';
import type { Zone } from '../types/zone';

export function CreateChorePage() {
  const { state } = useAuth();
  const household = state.status === 'authenticated' ? state.households[0] : undefined;
  const householdId = household?.id;
  const navigate = useNavigate();

  const [zoneTree, setZoneTree] = useState<Zone | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    zoneApi
      .getZoneTree(householdId)
      .then((result) => {
        if (!cancelled) setZoneTree(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'Could not load zones.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  async function handleSubmit(name: string, zoneIds: number[]) {
    if (!householdId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await choreApi.createChore(householdId, name, zoneIds);
      navigate('/');
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not create that chore.');
      setSubmitting(false);
    }
  }

  if (state.status === 'loading') return null;
  if (!household || household.role !== 'head') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="card">
      <h1>New chore</h1>
      <p className="card-eyebrow">For {household.name}</p>
      <ErrorBanner message={loadError ?? submitError} />
      {zoneTree ? (
        <CreateChoreForm
          zoneTree={zoneTree}
          submitting={submitting}
          onSubmit={(name, zoneIds) => void handleSubmit(name, zoneIds)}
        />
      ) : (
        !loadError && <p className="members-loading">Loading…</p>
      )}
      <p className="card-footer">
        <Link to="/">Cancel</Link>
      </p>
    </div>
  );
}
