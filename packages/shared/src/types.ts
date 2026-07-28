/**
 * Types shared by the scraper backend and every client.
 *
 * Deliberately free of platform dependencies -- no Node built-ins, no React
 * Native imports -- so this compiles unchanged into the server bundle, the
 * Expo app, and (later) an Android build.
 */

export const CATEGORIES = ['entertainment', 'daytime'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * A single dated instance of something happening at the resort.
 *
 * "Occurrence" rather than "event" is deliberate. The kiosk site reuses one
 * event id across multiple days -- id=3243 ("DJ Set", Sky Bar) shows up on
 * 27.07, 30.07 and 02.08 -- so an event id identifies a *show*, not a showing.
 * Everything downstream (dedup, notification bookkeeping, ICS UIDs, local
 * alarm ids) must key on the occurrence, never the event id.
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
  /**
   * Absolute start instant as an ISO string *with offset*, e.g.
   * "2026-07-31T21:00:00.000+03:00".
   *
   * Clients must schedule alarms from this, never by reassembling `date` and
   * `startTime`: the phone is not necessarily set to resort time, and an
   * absolute instant is correct in any timezone.
   */
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

/** Shape of `GET /api/schedule`. */
export interface SchedulePayload {
  now: string;
  timezone: string;
  leadMinutes: number;
  lastScrapeAt: string | null;
  lastScrapeError: string | null;
  occurrences: Occurrence[];
}
