import { Fragment, useEffect, useState } from 'react';
import {
  getExistingSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../utils/push';

type Status = 'unsupported' | 'checking' | 'off' | 'on';

export function NotificationOptIn() {
  const [status, setStatus] = useState<Status>(isPushSupported() ? 'checking' : 'unsupported');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    let cancelled = false;
    getExistingSubscription()
      .then((subscription) => {
        if (!cancelled) setStatus(subscription ? 'on' : 'off');
      })
      .catch(() => {
        if (!cancelled) setStatus('off');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'unsupported') return null;

  async function handleToggle() {
    setBusy(true);
    setError(null);
    try {
      if (status === 'on') {
        await unsubscribeFromPush();
        setStatus('off');
      } else {
        await subscribeToPush();
        setStatus('on');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Fragment>
      <button
        role="menuitem"
        type="button"
        disabled={busy || status === 'checking'}
        onClick={() => void handleToggle()}
      >
        {status === 'on' ? 'Notifications on ✓' : 'Enable chore notifications'}
      </button>
      {error && <span className="notification-opt-in-error">{error}</span>}
    </Fragment>
  );
}
