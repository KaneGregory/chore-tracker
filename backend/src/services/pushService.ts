import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  timezone: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// The minimal shape sendToSubscriptionRow actually needs — callers (notifyUser's
// fan-out, and dailyReminderScheduler's single-device send) can pass a richer row
// (e.g. one that also carries timezone/lastDailyReminderAt) and it structurally fits.
export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

// Read lazily rather than once at import time, so this module has no import-time
// side effects (missing keys just mean notifyUser no-ops, with a warning only when a
// push is actually attempted — unlike CORS_ORIGIN, we don't fail the whole server on
// startup, since push is an enhancement rather than core request handling).
function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function getPublicKey(): string | null {
  return getVapidConfig()?.publicKey ?? null;
}

export function saveSubscription(userId: number, subscription: PushSubscriptionInput): void {
  const now = Date.now();
  db.insert(pushSubscriptions)
    .values({
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      timezone: subscription.timezone,
      createdAt: now,
    })
    // Re-subscribing (e.g. after clearing site data, or NotificationOptIn's silent
    // timezone resync on load) reuses the same endpoint — treat it as
    // claiming/refreshing the row rather than erroring on the unique constraint.
    // Deliberately doesn't touch lastDailyReminderAt: a resync shouldn't reset
    // "already checked today" and risk a duplicate daily reminder.
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        timezone: subscription.timezone,
      },
    })
    .run();
}

export function removeSubscription(userId: number, endpoint: string): void {
  db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .run();
}

// Best-effort and not awaited by callers: a dead subscription or push-service outage
// must never break whatever triggered this. A 404/410 response means the browser has
// discarded that subscription, so the row is deleted here rather than requiring a
// separate sweep job.
function sendToSubscriptionRow(
  config: VapidConfig,
  subscription: PushSubscriptionRow,
  payload: PushPayload,
): void {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  webpush
    .sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    )
    .catch((err: unknown) => {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id)).run();
      } else {
        console.error('Failed to send push notification:', err);
      }
    });
}

// Fans out to every device the user has enabled notifications on.
export function notifyUser(userId: number, payload: PushPayload): void {
  const config = getVapidConfig();
  if (!config) {
    console.warn(
      'Push notification skipped — VAPID keys not configured. See backend/.env.example.',
    );
    return;
  }

  const subscriptions = db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .all();

  for (const subscription of subscriptions) {
    sendToSubscriptionRow(config, subscription, payload);
  }
}

// Sends to exactly one device, not the user's whole fleet — used by
// dailyReminderScheduler.ts, which checks (and must notify) each subscription
// independently at its own device's local 9am, not all of a user's devices at once.
export function notifyOneSubscription(subscription: PushSubscriptionRow, payload: PushPayload): void {
  const config = getVapidConfig();
  if (!config) return;
  sendToSubscriptionRow(config, subscription, payload);
}
