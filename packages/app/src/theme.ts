/** Carried over from the PWA so both clients look like the same product. */
export const theme = {
  bg: '#12152e',
  card: '#1e2246',
  card2: '#262b52',
  ink: '#f2f3fa',
  muted: '#a2a7c8',
  accent: '#f2b880',
  entertainment: '#f2b880',
  daytime: '#7fd1c1',
  ok: '#7fd1c1',
  warn: '#f0a0a0',
} as const;

export const RESORT_TZ = 'Europe/Athens';

/**
 * Format helpers pinned to resort time.
 *
 * The phone may be set to a different timezone (travelling, or simply not
 * updated yet), but "21:00" must always mean 21:00 at the resort -- that is
 * what is printed on the kiosk and what the guest will read on a sign.
 */
const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: RESORT_TZ,
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: RESORT_TZ,
});

export function formatDayHeading(
  isoDate: string,
  todayIso: string,
  tomorrowIso: string,
): string {
  if (isoDate === todayIso) return 'Today';
  if (isoDate === tomorrowIso) return 'Tomorrow';
  return dayFormatter.format(new Date(`${isoDate}T12:00:00Z`));
}

export function formatClock(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** "in 25 min" / "in 3 h 10 m" / "now". */
export function formatRelative(iso: string, from = new Date()): string {
  const mins = Math.round((new Date(iso).getTime() - from.getTime()) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} h ${m} m` : `in ${h} h`;
}

/** ISO date (YYYY-MM-DD) for an instant, in resort time. */
export function resortDateOf(d: Date): string {
  // en-CA gives ISO-ordered date parts.
  return new Intl.DateTimeFormat('en-CA', { timeZone: RESORT_TZ }).format(d);
}
