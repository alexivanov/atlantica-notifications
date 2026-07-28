import { DateTime } from 'luxon';
import { RESORT_TZ } from '../config.js';

/**
 * The kiosk site labels each day group in one of three ways:
 *
 *   "Today, 27.07."      "Tomorrow, 28.07."      "Wednesday, 29.07."
 *
 * Note what is missing: the year. On 28 December the site will happily print
 * "Saturday, 02.01." and expect you to work it out. These helpers turn a label
 * into a concrete date in the resort's timezone.
 */

const WEEKDAYS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export interface ResolvedDay {
  /** ISO date, e.g. "2026-08-01". */
  date: string;
  /** The raw label it came from, kept for logging. */
  label: string;
  /**
   * True when the label named a weekday and that weekday matched the date we
   * computed. False when the label carried no weekday to check against.
   * A *mismatch* throws rather than setting this to false.
   */
  weekdayVerified: boolean;
}

export class DateResolutionError extends Error {}

/**
 * Resolve a day label to an ISO date.
 *
 * @param label the raw text of the `.day` cell
 * @param now   injectable "current time" so this is testable; defaults to real
 *              now in the resort timezone
 */
export function resolveDayLabel(label: string, now?: DateTime): ResolvedDay {
  const today = (now ?? DateTime.now().setZone(RESORT_TZ)).startOf('day');
  const cleaned = label.trim().replace(/\s+/g, ' ');

  if (!cleaned) throw new DateResolutionError('empty day label');

  const lower = cleaned.toLowerCase();

  // "27.07." / "1.8." -- the numeric part is the authoritative signal when
  // present, because "Today"/"Tomorrow" are only correct relative to when the
  // page was rendered, and our copy may be minutes old.
  const dm = cleaned.match(/(\d{1,2})\.(\d{1,2})\./);

  let resolved: DateTime;

  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    resolved = inferYear(day, month, today);
  } else if (lower.startsWith('today')) {
    resolved = today;
  } else if (lower.startsWith('tomorrow')) {
    resolved = today.plus({ days: 1 });
  } else {
    throw new DateResolutionError(`cannot parse day label: "${label}"`);
  }

  // If the label names a weekday, use it as a free correctness check on the
  // year we just inferred. A mismatch means our clock, timezone, or inference
  // window is wrong -- and silently sending reminders on the wrong day is a
  // much worse outcome than failing loudly here.
  const weekdayWord = lower.match(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  let weekdayVerified = false;
  if (weekdayWord) {
    const expected = WEEKDAYS[weekdayWord[1]];
    if (resolved.weekday !== expected) {
      throw new DateResolutionError(
        `weekday mismatch for "${label}": resolved ${resolved.toISODate()} ` +
          `is a ${resolved.weekdayLong}, but the site says ${weekdayWord[1]}. ` +
          `Year inference or timezone is wrong.`,
      );
    }
    weekdayVerified = true;
  }

  return {
    date: resolved.toISODate()!,
    label: cleaned,
    weekdayVerified,
  };
}

/**
 * Pick the year that places day/month nearest to now.
 *
 * The site only ever shows a rolling week, so the correct date always sits in a
 * narrow window around today. We test last year, this year and next year, and
 * take whichever candidate lands inside [today - 1d, today + 10d]. That handles
 * the December -> January rollover without any special-casing, and the slack on
 * either side absorbs timezone skew and a stale cached page.
 */
function inferYear(day: number, month: number, today: DateTime): DateTime {
  const lower = today.minus({ days: 1 });
  const upper = today.plus({ days: 10 });

  const candidates: DateTime[] = [];
  for (const year of [today.year - 1, today.year, today.year + 1]) {
    const dt = DateTime.fromObject(
      { year, month, day },
      { zone: RESORT_TZ },
    ).startOf('day');
    // Guards against 31.02 and friends -- luxon reports these as invalid.
    if (dt.isValid) candidates.push(dt);
  }

  if (candidates.length === 0) {
    throw new DateResolutionError(`invalid date ${day}.${month}.`);
  }

  const inWindow = candidates.filter((c) => c >= lower && c <= upper);
  if (inWindow.length === 1) return inWindow[0];

  // Nothing landed in the window. This is expected when parsing an archived
  // fixture, so rather than throwing we fall back to the closest candidate.
  if (inWindow.length === 0) {
    return candidates.reduce((best, c) =>
      Math.abs(c.diff(today).milliseconds) < Math.abs(best.diff(today).milliseconds)
        ? c
        : best,
    );
  }

  return inWindow[0];
}

/**
 * Combine an ISO date and a "HH:mm" wall-clock time into an absolute instant,
 * interpreting the time in the resort's timezone.
 */
export function resortDateTime(date: string, time: string): DateTime {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: RESORT_TZ });
  if (!dt.isValid) {
    throw new DateResolutionError(`invalid date/time: ${date} ${time}`);
  }
  return dt;
}

/**
 * Parse an event_time cell like "21:00 - 23:30" or "21:15-22:30".
 * End time is optional -- some entries only give a start.
 */
export function parseTimeRange(
  raw: string,
): { start: string; end: string | null } | null {
  const times = raw.match(/(\d{1,2}):(\d{2})/g);
  if (!times || times.length === 0) return null;
  const norm = (t: string) => {
    const [h, m] = t.split(':');
    return `${h.padStart(2, '0')}:${m}`;
  };
  return {
    start: norm(times[0]),
    end: times.length > 1 ? norm(times[1]) : null,
  };
}
