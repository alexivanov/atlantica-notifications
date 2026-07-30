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

export interface StoreShape {
  occurrences: Record<string, Occurrence>;
  /**
   * Per-person category toggles, keyed by owner id.
   *
   * Kept separately from `subscriptions` because a native client schedules its
   * own local notifications and therefore has no push subscription to hang
   * preferences off -- but still needs them to survive a reinstall.
   */
  preferences: Record<string, Record<Category, boolean>>;
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
  lastScrapeAt: string | null;
  lastScrapeError: string | null;
}

export function emptyStore(): StoreShape {
  return {
    occurrences: {},
    preferences: {},
    daytimeSource: null,
    daytimeSourceChangedAt: null,
    lastScrapeAt: null,
    lastScrapeError: null,
  };
}
