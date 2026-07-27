import { DateTime } from 'luxon';
import { LEAD_MINUTES } from './config.js';
import type { Category } from './config.js';
import type { Occurrence } from './types.js';

/**
 * Emit the same occurrences as a subscribable calendar.
 *
 * This is the backstop for Web Push. iOS push through a home-screen PWA is
 * good but not bulletproof, and there is no second chance at a week-long trip --
 * a subscribed calendar puts the reminders in the system Calendar app, which
 * has its own independent alarm path. ~40 lines for real redundancy.
 */
export function buildIcs(
  occurrences: Occurrence[],
  opts: { categories?: Category[]; name?: string } = {},
): string {
  const wanted = opts.categories ?? ['entertainment', 'daytime'];
  const name = opts.name ?? 'Atlantica Imperial Resort';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//atlantica-notifications//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Europe/Athens',
    // Hint to clients how often to re-poll. iOS honours this loosely.
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];

  const stamp = utc(DateTime.utc());

  for (const occ of occurrences) {
    if (!wanted.includes(occ.category)) continue;

    const start = DateTime.fromISO(occ.startsAt);
    if (!start.isValid) continue;

    // Entertainment gives an end time; daytime activities don't, so assume an
    // hour rather than emitting a zero-length event (which some clients hide).
    const end = occ.endTime
      ? DateTime.fromISO(`${occ.date}T${occ.endTime}`, { zone: 'Europe/Athens' })
      : start.plus({ hours: 1 });

    // An end time earlier than the start means the event runs past midnight.
    const realEnd = end < start ? end.plus({ days: 1 }) : end;

    const desc = [occ.description, occ.url].filter(Boolean).join('\n\n');

    lines.push(
      'BEGIN:VEVENT',
      // Stable per-occurrence UID so re-publishing updates rather than
      // duplicates. Uses the occurrence key, not the site's event id, which
      // repeats across days.
      `UID:${escapeText(occ.key)}@atlantica-notifications`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(start.toUTC())}`,
      `DTEND:${utc(realEnd.toUTC())}`,
      `SUMMARY:${escapeText(occ.title)}`,
      ...(occ.venue ? [`LOCATION:${escapeText(occ.venue)}`] : []),
      ...(desc ? [`DESCRIPTION:${escapeText(desc)}`] : []),
      `CATEGORIES:${occ.category.toUpperCase()}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-PT${LEAD_MINUTES}M`,
      `DESCRIPTION:${escapeText(occ.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  // RFC 5545 wants CRLF line endings; some clients are strict about it.
  return lines.map(fold).join('\r\n') + '\r\n';
}

function utc(dt: DateTime): string {
  return dt.toFormat("yyyyLLdd'T'HHmmss'Z'");
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 caps content lines at 75 octets; continuations start with a space. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    out.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) out.push(' ' + rest);
  return out.join('\r\n');
}
