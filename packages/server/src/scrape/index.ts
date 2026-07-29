import { DateTime } from 'luxon';
import { RESORT_TZ } from '../config.js';
import * as store from '../store.js';
import type { Occurrence } from '../types.js';
import { sendTo } from '../notify/push.js';
import {
  checkDaytimeSource,
  expandWeeklySchedule,
  loadWeeklySchedule,
} from './daytime.js';
import { fetchEntertainment } from './entertainment.js';

export interface ScrapeResult {
  entertainment: number;
  daytime: number;
  errors: string[];
}

/**
 * Refresh both schedules and merge them into the store.
 *
 * Entertainment and daytime are refreshed independently: a failure scraping the
 * kiosk site must not wipe out the daytime timetable (or vice versa), and a
 * transient network blip should never remove occurrences we already know about.
 */
export async function runScrape(now?: DateTime): Promise<ScrapeResult> {
  const at = now ?? DateTime.now().setZone(RESORT_TZ);
  const errors: string[] = [];
  let entertainment: Occurrence[] = [];
  let daytime: Occurrence[] = [];

  try {
    entertainment = await fetchEntertainment(at);
  } catch (err) {
    const msg = `entertainment: ${(err as Error).message}`;
    errors.push(msg);
    console.error(`[scrape] ${msg}`);
  }

  try {
    daytime = expandWeeklySchedule(await loadWeeklySchedule(), at);
  } catch (err) {
    const msg = `daytime: ${(err as Error).message}`;
    errors.push(msg);
    console.error(`[scrape] ${msg}`);
  }

  const fresh = [...entertainment, ...daytime];

  await store.update((s) => {
    for (const occ of fresh) {
      // Preserve nothing from the old record -- the site is authoritative --
      // but never delete occurrences that are missing from this run, since a
      // partial scrape shouldn't erase tomorrow's schedule.
      s.occurrences[occ.key] = occ;
    }
    s.lastScrapeAt = new Date().toISOString();
    s.lastScrapeError = errors.length ? errors.join('; ') : null;
  });

  await checkForNewDaytimePdf();

  return { entertainment: entertainment.length, daytime: daytime.length, errors };
}

/**
 * The daytime grid is transcribed by hand, so the one thing we must not miss is
 * the resort quietly publishing a replacement PDF. Notify rather than fail --
 * the old timetable is still mostly right, but it needs a human look.
 */
async function checkForNewDaytimePdf(): Promise<void> {
  const current = await checkDaytimeSource();
  if (!current) return;

  const state = await store.load();
  const previous = state.daytimeSource;

  await store.update((s) => {
    s.daytimeSource = current;
  });

  if (!previous) return; // First observation -- nothing to compare against.

  if (previous.sha256 !== current.sha256 || previous.pdfUrl !== current.pdfUrl) {
    console.warn(
      `[daytime] PDF changed!\n  was: ${previous.pdfUrl}\n  now: ${current.pdfUrl}\n` +
        '  data/daytime-schedule.json needs re-transcribing.',
    );

    // Recorded so the signal survives the removal of push: it surfaces on
    // /healthz and in the app rather than depending on a notification.
    await store.update((s) => {
      s.daytimeSourceChangedAt = new Date().toISOString();
    });
    const fresh = await store.load();
    for (const sub of fresh.subscriptions) {
      await sendTo(sub, {
        title: 'Daytime programme updated',
        body: 'The resort published a new weekly activity schedule. Times may have changed.',
        tag: 'daytime-pdf-changed',
        url: '/',
      });
    }
  }
}
