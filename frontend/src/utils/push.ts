import * as pushApi from '../api/pushApi';

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// The Push API wants the VAPID public key as a raw Uint8Array, but the server hands
// it over base64url-encoded (the standard wire format for a VAPID key).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    bytes[i] = rawData.charCodeAt(i);
  }
  return bytes;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

function getTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function toSubscribeRequest(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('Unexpected push subscription shape from the browser.');
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    timezone: getTimeZone(),
  };
}

export async function subscribeToPush(): Promise<void> {
  const publicKey = await pushApi.getPublicKey();
  if (!publicKey) throw new Error('Push notifications are not configured on the server.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await pushApi.subscribe(toSubscribeRequest(subscription));
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  await pushApi.unsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
}

// Best-effort, silent: keeps the server's record of this device's time zone fresh
// (it drives the daily reminder's "9am local time" check) for anyone who already
// subscribed before that feature existed, or who's since traveled — without asking
// them to re-opt-in. Never surfaces an error; a failed resync just means the next
// mount tries again.
export async function resyncPushSubscription(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  try {
    await pushApi.subscribe(toSubscribeRequest(subscription));
  } catch {
    // Silent by design — see comment above.
  }
}
