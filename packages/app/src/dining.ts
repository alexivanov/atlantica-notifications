import {
  isOpenAt,
  timeOf,
  weekdayOf,
  type OpenState,
  type Venue,
  type VenueMenu,
  type Weekday,
} from '@atlantica/shared';
import { RESORT_TZ } from './theme';
import venuesData from '@atlantica/shared/data/venues.json';
import menusData from '@atlantica/shared/data/menus.json';

/**
 * Dining data, bundled with the app.
 *
 * Both files are committed static JSON, so the Dining screens work with no
 * network at all -- which is the point at a resort. Nothing here fetches.
 */

interface VenuesFile {
  venues: Venue[];
  themeNights: Record<string, string>;
  specialEvents: SpecialEvent[];
  info: InfoPage[];
}

export interface SpecialEvent {
  name: string;
  chef?: string;
  accolade?: string;
  /** ISO date, resort-local. */
  date: string;
  venue: string;
  price?: string;
  description?: string;
}

export interface InfoPage {
  slug: string;
  title: string;
  body?: string;
  pdf?: string;
  pdfs?: string[];
  bookingUrl?: string;
}

const file = venuesData as unknown as VenuesFile;

export const VENUES: Venue[] = file.venues;
export const THEME_NIGHTS = file.themeNights;
export const SPECIAL_EVENTS: SpecialEvent[] = file.specialEvents ?? [];
export const INFO_PAGES: InfoPage[] = file.info ?? [];
export const MENUS = menusData as unknown as Record<string, VenueMenu>;

export function menuFor(venue: Venue): VenueMenu | null {
  return venue.menuKey ? (MENUS[venue.menuKey] ?? null) : null;
}

export interface VenueStatus {
  venue: Venue;
  state: OpenState;
  /** Sort bucket: open first, then those opening later, then the rest. */
  group: 'open' | 'later' | 'closed';
}

/**
 * Group venues by whether they are open, using resort time rather than the
 * phone's -- the two differ often enough to matter, and "open now" is the whole
 * question this screen answers.
 */
export function venueStatuses(now = new Date()): VenueStatus[] {
  const day: Weekday = weekdayOf(now, RESORT_TZ);
  const time = timeOf(now, RESORT_TZ);

  return VENUES.filter((v) => v.kind !== 'info')
    .map<VenueStatus>((venue) => {
      const state = isOpenAt(venue, day, time);
      const group = state.open ? 'open' : state.next ? 'later' : 'closed';
      return { venue, state, group };
    })
    .sort((a, b) => {
      const rank = { open: 0, later: 1, closed: 2 } as const;
      if (rank[a.group] !== rank[b.group]) return rank[a.group] - rank[b.group];
      // Within "opening later", soonest first.
      if (a.group === 'later' && a.state.next && b.state.next) {
        return a.state.next.from.localeCompare(b.state.next.from);
      }
      return a.venue.name.localeCompare(b.venue.name);
    });
}

/** Tonight's buffet theme at Agora. */
export function themeTonight(now = new Date()): string | null {
  return THEME_NIGHTS[weekdayOf(now, RESORT_TZ)] ?? null;
}

/** Special dinners still to come, soonest first. */
export function upcomingSpecialEvents(now = new Date()): SpecialEvent[] {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: RESORT_TZ }).format(now);
  return SPECIAL_EVENTS.filter((e) => e.date >= today).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/** "07:30–10:30" or "Breakfast 07:30–10:30". */
export function formatPeriod(p: { label?: string; from: string; to: string }): string {
  const range = `${p.from}–${p.to === '00:00' ? 'midnight' : p.to}`;
  return p.label ? `${p.label} ${range}` : range;
}

/** "€9.50" / "€9.50 → €4.75" is built in the UI; this just formats one price. */
export function euro(n: number): string {
  return `€${n.toFixed(2)}`;
}
