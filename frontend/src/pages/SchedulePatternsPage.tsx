import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { PatternForm } from '../components/household/PatternForm';
import { ErrorBanner } from '../components/common/ErrorBanner';
import * as patternApi from '../api/patternApi';
import { ApiError } from '../api/httpClient';
import type { CreatePatternInput, SchedulePattern } from '../types/pattern';

const RECURRENCE_LABEL: Record<SchedulePattern['recurrenceType'], (pattern: SchedulePattern) => string> = {
  every_n_days: (pattern) => `Every ${pattern.intervalDays} day(s) at ${pattern.startTime}`,
  weekly: (pattern) => `Every ${pattern.intervalWeeks} week(s) at ${pattern.startTime}`,
  monthly: (pattern) => `Every ${pattern.intervalMonths} month(s) on day ${pattern.dayOfMonth} at ${pattern.startTime}`,
};

export function SchedulePatternsPage() {
  const { householdId: householdIdParam } = useParams();
  const householdId = Number(householdIdParam);
  const { state } = useAuth();

  const [patterns, setPatterns] = useState<SchedulePattern[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const household =
    state.status === 'authenticated'
      ? state.households.find((candidate) => candidate.id === householdId)
      : undefined;

  useEffect(() => {
    if (!household) return;
    let cancelled = false;
    patternApi
      .listPatterns(householdId)
      .then((result) => {
        if (!cancelled) setPatterns(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load schedule patterns.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, household]);

  async function handleCreate(input: CreatePatternInput) {
    setBusy(true);
    setError(null);
    try {
      const created = await patternApi.createPattern(householdId, input);
      setPatterns((prev) => [...(prev ?? []), created]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that pattern.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(patternId: number) {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await patternApi.renamePattern(householdId, patternId, { name: trimmed });
      setPatterns((prev) => prev?.map((pattern) => (pattern.id === patternId ? updated : pattern)) ?? prev);
      setRenamingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename that pattern.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(patternId: number) {
    setBusy(true);
    setError(null);
    try {
      await patternApi.removePattern(householdId, patternId);
      setPatterns((prev) => prev?.filter((pattern) => pattern.id !== patternId) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that pattern.');
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') return null;
  if (!household) {
    return <Navigate to="/" replace />;
  }
  const isHead = household.role === 'head';

  return (
    <div className="card">
      <h1>Schedule patterns</h1>
      <p className="card-eyebrow">For {household.name}</p>
      <ErrorBanner message={error} />
      {patterns ? (
        <ul className="pattern-list">
          {patterns.map((pattern) => (
            <li className="pattern-list-item" key={pattern.id}>
              {renamingId === pattern.id ? (
                <span className="pattern-rename-form">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-text"
                    disabled={busy}
                    onClick={() => void handleRename(pattern.id)}
                  >
                    Save
                  </button>
                  <button type="button" className="btn btn-text" onClick={() => setRenamingId(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <span className="pattern-name">{pattern.name}</span>
                  <span className="pattern-summary">{RECURRENCE_LABEL[pattern.recurrenceType](pattern)}</span>
                  {isHead && (
                    <span className="pattern-actions">
                      <button
                        type="button"
                        className="btn btn-text"
                        onClick={() => {
                          setRenamingId(pattern.id);
                          setRenameValue(pattern.name);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn-text"
                        disabled={busy}
                        onClick={() => void handleRemove(pattern.id)}
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !error && <p className="members-loading">Loading patterns…</p>
      )}
      {isHead && <PatternForm submitting={busy} onSubmit={(input) => void handleCreate(input)} />}
      <p className="card-footer">
        <Link to="/">Back</Link>
      </p>
    </div>
  );
}
