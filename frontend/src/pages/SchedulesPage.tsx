import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { ErrorBanner } from '../components/common/ErrorBanner';
import * as scheduleTemplateApi from '../api/scheduleTemplateApi';
import { ApiError } from '../api/httpClient';
import type { ScheduleTemplate } from '../types/scheduleTemplate';

const RECURRENCE_LABEL: Record<ScheduleTemplate['recurrenceType'], (template: ScheduleTemplate) => string> = {
  every_n_days: (template) => `Every ${template.intervalDays} day(s) at ${template.startTime}`,
  weekly: (template) => `Every ${template.intervalWeeks} week(s) at ${template.startTime}`,
  monthly: (template) =>
    `Every ${template.intervalMonths} month(s) on day ${template.dayOfMonth} at ${template.startTime}`,
};

export function SchedulesPage() {
  const { state } = useAuth();
  const household = state.status === 'authenticated' ? state.households[0] : undefined;
  const householdId = household?.id;

  const [templates, setTemplates] = useState<ScheduleTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<number | null>(null);

  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    scheduleTemplateApi
      .listScheduleTemplates(householdId)
      .then((result) => {
        if (!cancelled) setTemplates(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load schedules.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  async function handleRemove(scheduleTemplateId: number) {
    if (!householdId) return;
    setBusy(true);
    setError(null);
    try {
      await scheduleTemplateApi.removeScheduleTemplate(householdId, scheduleTemplateId);
      setTemplates((prev) => prev?.filter((template) => template.id !== scheduleTemplateId) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that schedule.');
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
    <>
      <div className="page-header">
        <div className="page-header-title">
          <h1>Schedules</h1>
        </div>
        {isHead && (
          <Link to="/schedules/new" className="btn-fab" aria-label="Add schedule">
            +
          </Link>
        )}
      </div>
      <p className="card-eyebrow">For {household.name}</p>
      <ErrorBanner message={error} />
      {templates ? (
        templates.length > 0 ? (
          <ul className="chores-list">
            {templates.map((template) => (
              <li className="chore-card" key={template.id}>
                {isHead && confirmingRemoveId !== template.id && (
                  <button
                    type="button"
                    className="chore-remove-btn"
                    onClick={() => setConfirmingRemoveId(template.id)}
                    aria-label={`Remove ${template.name}`}
                  >
                    ×
                  </button>
                )}
                <div className="chore-row-main">
                  <span className="chore-name">{template.name}</span>
                </div>
                {confirmingRemoveId === template.id && (
                  <div className="zone-inline-form">
                    <span>Remove this schedule?</span>
                    <button
                      type="button"
                      className="btn btn-pill-outline"
                      disabled={busy}
                      onClick={() => {
                        void handleRemove(template.id);
                        setConfirmingRemoveId(null);
                      }}
                    >
                      {busy ? 'Removing…' : 'Yes, remove'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-text"
                      onClick={() => setConfirmingRemoveId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <div className="chore-schedule-control">
                  <span className="chore-schedule-summary">
                    {RECURRENCE_LABEL[template.recurrenceType](template)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="chores-empty">No schedules yet.</p>
        )
      ) : (
        !error && <p className="members-loading">Loading schedules…</p>
      )}
      <p className="card-footer">
        <Link to="/">Back</Link>
      </p>
    </>
  );
}
