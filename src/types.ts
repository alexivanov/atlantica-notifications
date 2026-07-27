import type { Category } from './config.js';

/**
 * A single dated instance of something happening at the resort.
 *
 * "Occurrence" rather than "event" is deliberate. The kiosk site reuses one
 * event id across multiple days -- id=3243 ("DJ Set", Sky Bar) shows up on
 * 27.07, 30.07 and 02.08 -- so an event id identifies a *show*, not a showing.
 * Everything downstream (dedup, notification bookkeeping, ICS UIDs) must key on
 * the occurrence, never the event id.
 */
export interface Occurrence {
  /** `${category}|${date}|${startTime}|${sourceId}` -- unique per showing. */
  key: string;
  category: Category;
  /** Site event id for entertainment; a slug for recurring daytime items. */
  sourceId: string;
  title: string;
  /** ISO date in resort-local time, e.g. "2026-07-31". */
  date: string;
  /** Wall-clock "HH:mm" in resort-local time. */
  startTime: string;
  endTime: string | null;
  venue: string | null;
  description: string | null;
  /** Absolute start instant as an ISO string with offset. */
  startsAt: string;
  /** Link back to the kiosk page, when there is one. */
  url: string | null;
}

export function occurrenceKey(
  category: Category,
  date: string,
  startTime: string,
  sourceId: string,
): string {
  return `${category}|${date}|${startTime}|${sourceId}`;
}

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

export interface StoreShape {
  occurrences: Record<string, Occurrence>;
  subscriptions: PushSubscriptionRecord[];
  /** `${occurrenceKey}` -> ISO timestamp the reminder was sent. */
  sent: Record<string, string>;
  /** Content hash of the daytime PDF, to notice the resort republishing it. */
  daytimeSource: { pdfUrl: string; sha256: string; checkedAt: string } | null;
  /** Set once the first scrape completes, so we can suppress a backfill burst. */
  initialised: boolean;
  lastScrapeAt: string | null;
  lastScrapeError: string | null;
}

export function emptyStore(): StoreShape {
  return {
    occurrences: {},
    subscriptions: [],
    sent: {},
    daytimeSource: null,
    initialised: false,
    lastScrapeAt: null,
    lastScrapeError: null,
  };
}
