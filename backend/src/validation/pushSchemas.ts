import { z } from 'zod';

// A subscription's endpoint is where notifyUser (pushService.ts) later sends a real
// outbound HTTP request, on a trigger an ordinary household member can pull
// themselves (e.g. a head marking their own assigned chore overdue) — without this,
// any authenticated member could register an arbitrary endpoint and turn the server
// into a blind SSRF proxy against internal services or the cloud metadata endpoint.
// Real push services (FCM, Mozilla, APNs, etc.) are always public https:// hosts, so
// requiring that and rejecting loopback/private/link-local hosts costs nothing for
// legitimate subscriptions.
const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
];

function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return !PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(url.hostname));
}

const pushEndpointSchema = z
  .string()
  .url()
  .refine(isPublicHttpsUrl, 'Push endpoint must be a public https:// URL');

export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});
