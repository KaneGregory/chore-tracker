import webpush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
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
      createdAt: now,
    })
    // Re-subscribing (e.g. after clearing site data) reuses the same endpoint —
    // treat it as claiming/refreshing the row rather than erroring on the unique
    // constraint.
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
    })
    .run();
}

export function removeSubscription(userId: number, endpoint: string): void {
  db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .run();
}

// Best-effort and not awaited by callers: a dead subscription or push-service outage
// must never break the chore mutation that triggered this. A 404/410 response means
// the browser has discarded that subscription, so the row is deleted here rather than
// requiring a separate sweep job.
export function notifyUser(userId: number, payload: PushPayload): void {
  const config = getVapidConfig();
  if (!config) {
    console.warn(
      'Push notification skipped — VAPID keys not configured. See backend/.env.example.',
    );
    return;
  }
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const subscriptions = db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .all();

  for (const subscription of subscriptions) {
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
}
