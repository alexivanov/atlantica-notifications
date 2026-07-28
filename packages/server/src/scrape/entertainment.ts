import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';
import { SOURCES } from '../config.js';
import { occurrenceKey, type Occurrence } from '../types.js';
import { parseTimeRange, resolveDayLabel, resortDateTime } from './dates.js';

export class ScrapeError extends Error {}

/**
 * Parse the entertainment category page.
 *
 * The markup is a flat list of `div.single-product` cards. Crucially, the
 * `div.day` heading is only rendered on the FIRST card of each day group --
 * every subsequent card that day has an empty day cell. So we carry the last
 * seen day forward. Getting this wrong silently misdates roughly half the
 * schedule, which is the kind of bug you only notice by missing a show.
 */
export function parseEntertainment(html: string, now?: DateTime): Occurrence[] {
  const $ = cheerio.load(html);
  const cards = $('div.single-product');

  if (cards.length === 0) {
    throw new ScrapeError(
      'no .single-product cards found -- the site markup has probably changed',
    );
  }

  const occurrences: Occurrence[] = [];
  let currentDate: string | null = null;
  let currentLabel: string | null = null;

  cards.each((_, el) => {
    const card = $(el);

    // Sticky day header.
    const dayText = card.find('div.day').first().text().trim();
    if (dayText) {
      const resolved = resolveDayLabel(dayText, now);
      currentDate = resolved.date;
      currentLabel = resolved.label;
    }

    if (!currentDate) {
      // A card before any day heading -- we have no way to date it, so skip it
      // rather than guess.
      console.warn('[entertainment] card before any day heading, skipping');
      return;
    }

    const link = card.find('h4 a').first();
    const title = link.text().trim() || card.find('h4').first().text().trim();
    if (!title) return;

    const href = link.attr('href') ?? null;
    const idMatch = href?.match(/\/event\/(\d+)/);
    // Fall back to a title-based id so an id-less card still gets a stable key.
    const sourceId = idMatch ? idMatch[1] : slug(title);

    const range = parseTimeRange(card.find('div.event_time').first().text());
    if (!range) {
      console.warn(
        `[entertainment] no parseable time for "${title}" on ${currentDate}, skipping`,
      );
      return;
    }

    // short_description holds the venue in its first <p>, and occasionally a
    // blurb in the remaining ones.
    const paras = card
      .find('div.short_description p')
      .map((_i, p) => $(p).text().trim())
      .get()
      .filter(Boolean);
    const venue = paras[0] ?? null;
    const description = paras.length > 1 ? paras.slice(1).join(' ') : null;

    occurrences.push({
      key: occurrenceKey('entertainment', currentDate, range.start, sourceId),
      category: 'entertainment',
      sourceId,
      title,
      date: currentDate,
      startTime: range.start,
      endTime: range.end,
      venue,
      description,
      startsAt: resortDateTime(currentDate, range.start).toISO()!,
      url: href,
    });
  });

  if (occurrences.length === 0) {
    throw new ScrapeError(
      `found ${cards.length} cards but parsed 0 occurrences -- markup changed?`,
    );
  }

  void currentLabel;
  return occurrences;
}

export async function fetchEntertainment(now?: DateTime): Promise<Occurrence[]> {
  const res = await fetch(SOURCES.entertainment, {
    headers: {
      // Identify ourselves honestly; robots.txt allows this, and a real UA
      // avoids being served a degraded page.
      'User-Agent':
        'atlantica-notifications/1.0 (personal schedule reminders; 2 users)',
      'Accept-Language': 'en',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new ScrapeError(`entertainment fetch failed: HTTP ${res.status}`);
  }

  return parseEntertainment(await res.text(), now);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
