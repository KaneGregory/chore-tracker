import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';
import { notifyOneSubscription } from './pushService.js';
import { userHasIncompleteAssignedChores } from './choreService.js';

const CHECK_INTERVAL_MS = 60_000;
// Fixed for now, per the spec this implements ("for now we can have that set to 9am
// ... later this could be configurable") — not read from any config yet.
const REMINDER_HOUR = 9;

function localDateAndHour(timestampMs: number, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampMs));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

// Exported (and accepting `now` rather than reading Date.now() internally) so it's
// directly testable without waiting on real timers or manipulating the system clock.
export function checkDailyReminders(now: number = Date.now()): void {
  const subscriptions = db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      timezone: pushSubscriptions.timezone,
      lastDailyReminderAt: pushSubscriptions.lastDailyReminderAt,
    })
    .from(pushSubscriptions)
    .all();

  for (const subscription of subscriptions) {
    // Null for subscriptions created before this feature existed, or (defensively)
    // any stored value Intl no longer recognizes — skip until the client resyncs.
    if (!subscription.timezone) continue;

    let local: { date: string; hour: number };
    try {
      local = localDateAndHour(now, subscription.timezone);
    } catch {
      continue;
    }

    if (local.hour !== REMINDER_HOUR) continue;

    const alreadyCheckedToday =
      subscription.lastDailyReminderAt !== null &&
      localDateAndHour(subscription.lastDailyReminderAt, subscription.timezone).date === local.date;
    if (alreadyCheckedToday) continue;

    // Marked as checked regardless of whether anything gets sent below — a day with
    // zero outstanding chores still counts as "handled for today," or the next tick
    // (a minute later, still within the 9am hour) would just check it again.
    db.update(pushSubscriptions)
      .set({ lastDailyReminderAt: now })
      .where(eq(pushSubscriptions.id, subscription.id))
      .run();

    if (userHasIncompleteAssignedChores(subscription.userId)) {
      notifyOneSubscription(subscription, {
        title: 'Chores waiting for you',
        body: "You've got chores that still need doing today.",
        url: '/',
      });
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startDailyReminderScheduler(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => checkDailyReminders(), CHECK_INTERVAL_MS);
}

export function stopDailyReminderScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
