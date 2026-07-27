import webpush from 'web-push';
import { VAPID } from '../config.js';
import * as store from '../store.js';
import type { PushSubscriptionRecord } from '../types.js';

let configured = false;

export function configurePush(): boolean {
  if (configured) return true;
  if (!VAPID.publicKey || !VAPID.privateKey) {
    console.warn(
      '[push] VAPID keys missing -- notifications disabled. ' +
        'Run `npm run keys` and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.',
    );
    return false;
  }
  webpush.setVapidDetails(VAPID.subject, VAPID.publicKey, VAPID.privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/**
 * Send to one subscription.
 *
 * Returns false when the subscription is dead (404/410) -- the caller should
 * drop it. Apple's push service returns 410 once a user deletes the home-screen
 * app, and retrying forever against a dead endpoint is how these things start
 * failing silently.
 */
export async function sendTo(
  sub: PushSubscriptionRecord,
  payload: PushPayload,
): Promise<boolean> {
  if (!configurePush()) return true;

  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: sub.keys,
      },
      JSON.stringify(payload),
      { TTL: 3600, urgency: 'high' },
    );
    return true;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      console.warn(`[push] subscription ${sub.id} is gone (${status}), removing`);
      await store.update((s) => {
        s.subscriptions = s.subscriptions.filter((x) => x.id !== sub.id);
      });
      return false;
    }
    console.error(
      `[push] send to ${sub.id} failed (${status ?? '?'}):`,
      (err as Error).message,
    );
    return true;
  }
}
