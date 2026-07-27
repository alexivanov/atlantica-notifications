import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';
import { DAYTIME_HORIZON_DAYS, RESORT_TZ, SCHEDULE_FILE, SOURCES } from '../config.js';
import { occurrenceKey, type Occurrence } from '../types.js';
import { resortDateTime } from './dates.js';

/**
 * Daytime activities are published only inside a PDF ("Weekly Programme /
 * Wochenprogramm"), and it is a fixed weekly grid rather than a dated feed.
 *
 * We do NOT parse the PDF at runtime. Its text layer extracts as character-
 * split, locale-tagged fragments ("B e a ch Y o g a", de-DE/en-US markers) with
 * no reliable column-to-weekday mapping -- parsing it would be fragile for zero
 * benefit against a timetable that changes a couple of times a season. Instead
 * the grid is transcribed once into data/daytime-schedule.json, and we watch the
 * PDF's URL + content hash so we know when to re-transcribe.
 */

interface Slot {
  time: string;
  title: string;
  location: string;
}

interface WeeklySchedule {
  source: { pdfUrl: string };
  notes: string[];
  week: Record<string, Slot[]>;
}

const WEEKDAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/**
 * Resolved against the process working directory rather than import.meta.url,
 * so it points at the same file whether we're running from `src/` or `dist/`.
 */
export async function loadWeeklySchedule(
  path = SCHEDULE_FILE,
): Promise<WeeklySchedule> {
  return JSON.parse(await readFile(path, 'utf8')) as WeeklySchedule;
}

/**
 * Materialise the recurring weekly grid into concrete dated occurrences for the
 * next `DAYTIME_HORIZON_DAYS` days, so daytime items flow through exactly the
 * same dedup/notify/ICS path as scraped entertainment.
 */
export function expandWeeklySchedule(
  schedule: WeeklySchedule,
  now?: DateTime,
): Occurrence[] {
  const start = (now ?? DateTime.now().setZone(RESORT_TZ)).startOf('day');
  const out: Occurrence[] = [];

  for (let i = 0; i < DAYTIME_HORIZON_DAYS; i++) {
    const day = start.plus({ days: i });
    const name = WEEKDAY_NAMES[day.weekday - 1];
    const slots = schedule.week[name] ?? [];
    const date = day.toISODate()!;

    for (const slot of slots) {
      const sourceId = `${name}-${slot.time.replace(':', '')}-${slugify(slot.title)}`;
      out.push({
        key: occurrenceKey('daytime', date, slot.time, sourceId),
        category: 'daytime',
        sourceId,
        title: slot.title,
        date,
        startTime: slot.time,
        endTime: null,
        venue: slot.location,
        // The PDF asks guests to turn up early; surfacing it in the reminder is
        // more useful than burying it in a file nobody opens.
        description: 'Please arrive 5 minutes early at the meeting point.',
        startsAt: resortDateTime(date, slot.time).toISO()!,
        url: SOURCES.daytimePage,
      });
    }
  }

  return out;
}

export interface DaytimeSourceState {
  pdfUrl: string;
  sha256: string;
  checkedAt: string;
}

/**
 * Find the currently-linked PDF and hash it. If either the URL or the hash has
 * moved since we transcribed the grid, the resort has published a new
 * programme and data/daytime-schedule.json is stale.
 */
export async function checkDaytimeSource(): Promise<DaytimeSourceState | null> {
  try {
    const pageRes = await fetch(SOURCES.daytimePage, {
      headers: { 'User-Agent': 'atlantica-notifications/1.0' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!pageRes.ok) return null;

    const $ = cheerio.load(await pageRes.text());
    // The PDF is embedded in a viewer iframe: /web/viewer.html?file=<url>
    let pdfUrl: string | null = null;
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') ?? '';
      const m = src.match(/[?&]file=([^&]+)/);
      if (m) pdfUrl = decodeURIComponent(m[1]);
    });
    if (!pdfUrl) return null;

    const pdfRes = await fetch(pdfUrl, {
      headers: { 'User-Agent': 'atlantica-notifications/1.0' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!pdfRes.ok) return null;

    const buf = Buffer.from(await pdfRes.arrayBuffer());
    return {
      pdfUrl,
      sha256: createHash('sha256').update(buf).digest('hex'),
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[daytime] source check failed:', (err as Error).message);
    return null;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
