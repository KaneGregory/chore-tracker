export interface PushSubscriptionJson {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// What the browser gives us (PushSubscriptionJson) plus the IANA time zone the
// daily-reminder scheduler needs — captured client-side since the server has no
// other way to know it.
export interface SubscribePushRequest extends PushSubscriptionJson {
  timezone: string;
}
