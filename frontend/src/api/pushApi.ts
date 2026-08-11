import { apiRequest } from './httpClient';
import type { PushSubscriptionJson } from '../types/push';

export async function getPublicKey(): Promise<string | null> {
  const response = await apiRequest<{ publicKey: string | null }>('/api/push/public-key');
  return response.publicKey;
}

export function subscribe(subscription: PushSubscriptionJson): Promise<void> {
  return apiRequest<void>('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}

export function unsubscribe(endpoint: string): Promise<void> {
  return apiRequest<void>('/api/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}
