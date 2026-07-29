import type { Category, Occurrence } from '@atlantica/shared';

/**
 * Server-only state shapes.
 *
 * The wire types (`Occurrence`, `Category`, `occurrenceKey`) now live in
 * @atlantica/shared so the native app compiles against the exact same
 * definitions the scraper produces. Re-exported here so existing server
 * imports keep working unchanged.
 */

export type { Category, Occurrence };
export { CATEGORIES, occurrenceKey } from '@atlantica/shared';

export interface PushSubscriptionRecord {
  id: string;
  /** Which invite token this subscription was created under. */
  owner: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Per-person category mute switches. */
  enabled: Record<Category, boolean>;
  createdAt: string;
}

/** A native client that redeemed an invite token. */
export interface DeviceRecord {
  /** The bearer token, stored hashed -- never in plaintext. */
  tokenHash: string;
  /** Which invite token it was redeemed under. */
  owner: string;
  /** Free-text label from the client, e.g. "iPhone 15". */
  label: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface StoreShape {
  occurrences: Record<string, Occurrence>;
  subscriptions: PushSubscriptionRecord[];
  /** Bearer tokens issued to native app installs. */
  devices: DeviceRecord[];
  /**
   * Per-person category toggles, keyed by owner id.
   *
   * Kept separately from `subscriptions` because a native client schedules its
   * own local notifications and therefore has no push subscription to hang
   * preferences off -- but still needs them to survive a reinstall.
   */
  preferences: Record<string, Record<Category, boolean>>;
  /** `${occurrenceKey}` -> ISO timestamp the reminder was sent. */
  sent: Record<string, string>;
  /** Content hash of the daytime PDF, to notice the resort republishing it. */
  daytimeSource: { pdfUrl: string; sha256: string; checkedAt: string } | null;
  /**
   * When the resort last republished the daytime PDF.
   *
   * The prompt to re-transcribe data/daytime-schedule.json used to be a push
   * notification. Push is going away with the PWA, so the signal is persisted
   * and surfaced through the API instead -- losing it would let the daytime
   * timetable drift silently out of date.
   */
  daytimeSourceChangedAt: string | null;
  /** Set once the first scrape completes, so we can suppress a backfill burst. */
  initialised: boolean;
  lastScrapeAt: string | null;
  lastScrapeError: string | null;
}

export function emptyStore(): StoreShape {
  return {
    occurrences: {},
    subscriptions: [],
    devices: [],
    preferences: {},
    sent: {},
    daytimeSource: null,
    daytimeSourceChangedAt: null,
    initialised: false,
    lastScrapeAt: null,
    lastScrapeError: null,
  };
}
