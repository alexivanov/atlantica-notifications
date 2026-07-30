import {
  isOpenAt,
  timeOf,
  weekdayOf,
  type MenuItem,
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

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface SearchHit {
  venueSlug: string;
  venueName: string;
  categoryName: string;
  /** Index of the category within the venue, for linking. */
  categoryIndex: number;
  item: MenuItem;
  /** Lower is better. */
  score: number;
}

/**
 * Search every menu across every venue.
 *
 * 700 items over 10 venues is well past the point of browsing, so this is the
 * fastest route to "where do I get a mojito". Matching is deliberately naive --
 * substring, case-insensitive, name weighted above description -- because the
 * corpus is small and predictable, and fuzzy matching on drink names produces
 * more confusion than it solves.
 */
export function searchMenus(query: string, limit = 60): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const hits: SearchHit[] = [];

  for (const venue of VENUES) {
    const menu = menuFor(venue);
    if (!menu) continue;

    menu.categories.forEach((cat, categoryIndex) => {
      for (const item of cat.items) {
        const name = item.name.toLowerCase();
        const desc = item.description?.toLowerCase() ?? '';

        let score: number | null = null;
        if (name.startsWith(q)) score = 0;
        else if (name.includes(q)) score = 1;
        else if (cat.name.toLowerCase().includes(q)) score = 2;
        else if (desc.includes(q)) score = 3;

        if (score !== null) {
          hits.push({
            venueSlug: venue.slug,
            venueName: venue.name,
            categoryName: cat.name,
            categoryIndex,
            item,
            score,
          });
        }
      }
    });
  }

  return hits
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Feeling lucky
 * ------------------------------------------------------------------ */

export interface DrinkPick {
  item: MenuItem;
  venueName: string;
  venueSlug: string;
  categoryName: string;
  categoryIndex: number;
}

/** Cove serves food from these; everything else on a bar menu is a drink. */
const FOOD_CATEGORIES = new Set(['Snacks', 'Sushi']);

/** Bars, in "open first" order — the selector on the lucky screen. */
export function barVenues(now = new Date()): VenueStatus[] {
  return venueStatuses(now).filter(({ venue }) => venue.kind === 'bar');
}

/**
 * Drinks a given bar will pour at no extra cost.
 *
 * Restricted to `included` rather than "included or discounted": a discounted
 * item still costs money, and the point of a lucky spin is something you can
 * simply order. Food categories are excluded so The Cove does not offer sushi.
 */
export function drinkCandidates(venueSlug: string): DrinkPick[] {
  const venue = VENUES.find((v) => v.slug === venueSlug && v.kind === 'bar');
  if (!venue) return [];

  const menu = menuFor(venue);
  if (!menu) return [];

  const out: DrinkPick[] = [];
  menu.categories.forEach((cat, categoryIndex) => {
    if (FOOD_CATEGORIES.has(cat.name)) return;
    for (const item of cat.items) {
      if (item.allInclusive !== 'included') continue;
      out.push({
        item,
        venueName: venue.name,
        venueSlug: venue.slug,
        categoryName: cat.name,
        categoryIndex,
      });
    }
  });
  return out;
}

export function pickDrink(candidates: DrinkPick[]): DrinkPick | null {
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
