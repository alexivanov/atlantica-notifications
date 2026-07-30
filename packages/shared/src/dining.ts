/**
 * Venues, menus, and "is it open right now".
 *
 * All of this ships as committed static data (`data/venues.json`,
 * `data/menus.json`) rather than being fetched, so the Dining screens work
 * offline and there is no scraper to break. The only live thinking is the
 * open/closed calculation below.
 */

export type VenueKind = 'restaurant' | 'bar' | 'casual' | 'info';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export const WEEKDAYS: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export interface ServicePeriod {
  /** "Breakfast", "Light snack"… Absent means the venue's main opening hours. */
  label?: string;
  /** "HH:mm" in resort-local time. */
  from: string;
  /** "HH:mm"; "00:00" means midnight at the *end* of the day. */
  to: string;
  /** Only these days, if present. */
  days?: Weekday[];
  /** Every day except these. */
  exceptDays?: Weekday[];
}

export interface Venue {
  slug: string;
  name: string;
  kind: VenueKind;
  /** Key into menus.json, when the venue publishes a menu. */
  menuKey?: string;
  itemId: number;
  description?: string;
  periods: ServicePeriod[];
  /** Shown when `periods` is empty, explaining why. */
  hoursNote?: string;
  extraCharge?: boolean;
  reservationRequired?: boolean;
  weatherPermitting?: boolean;
  /** e.g. "Red Carpet guests only until 18:00". */
  restriction?: string;
  bookingUrl?: string;
}

export type AllInclusive = 'included' | 'discounted' | 'none';

export interface MenuItem {
  name: string;
  allInclusive: AllInclusive;
  /** Menu price in euros. */
  price?: number;
  /** What an all-inclusive guest pays, when discounted. */
  finalPrice?: number;
  description?: string;
}

export interface MenuCategory {
  name: string;
  items: MenuItem[];
}

export interface VenueMenu {
  name: string;
  project: number;
  /** Fraction off for discounted items, e.g. 0.5 = 50%. */
  aiRate: number;
  /** Where the rate depends on the category (The Cove: food vs drink). */
  aiRateByCategory?: Record<string, number>;
  /** Bill-level discount that is not per item. */
  note?: string;
  legend?: string;
  categories: MenuCategory[];
}

/* ------------------------------------------------------------------ *
 * Open / closed
 * ------------------------------------------------------------------ */

/** Minutes since midnight for "HH:mm". */
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * A period crosses midnight when its end is at or before its start.
 *
 * Every bar here closes at "00:00", which as a naive number is 0 and therefore
 * *before* the 10:00 opening — so without this every bar would read as closed
 * all day.
 */
function crossesMidnight(p: ServicePeriod): boolean {
  return minutes(p.to) <= minutes(p.from);
}

function appliesOn(p: ServicePeriod, day: Weekday): boolean {
  if (p.days && !p.days.includes(day)) return false;
  if (p.exceptDays && p.exceptDays.includes(day)) return false;
  return true;
}

/** The weekday immediately before the given one. */
function previousDay(day: Weekday): Weekday {
  const i = WEEKDAYS.indexOf(day);
  return WEEKDAYS[(i + WEEKDAYS.length - 1) % WEEKDAYS.length];
}

export interface OpenState {
  open: boolean;
  /** The period that is currently active, when open. */
  current?: ServicePeriod;
  /** The next period to begin today, when closed. */
  next?: ServicePeriod;
}

/**
 * Is the venue open at `day` / `time` (resort-local)?
 *
 * Takes wall-clock inputs rather than a Date so callers stay explicit about
 * which timezone they mean — the phone is not necessarily on resort time.
 */
export function isOpenAt(
  venue: Pick<Venue, 'periods'>,
  day: Weekday,
  time: string,
): OpenState {
  const now = minutes(time);

  // A period that began yesterday and runs past midnight still covers us.
  for (const p of venue.periods) {
    if (!crossesMidnight(p)) continue;
    if (!appliesOn(p, previousDay(day))) continue;
    if (now < minutes(p.to)) return { open: true, current: p };
  }

  for (const p of venue.periods) {
    if (!appliesOn(p, day)) continue;
    const from = minutes(p.from);
    const to = minutes(p.to);
    if (crossesMidnight(p)) {
      if (now >= from) return { open: true, current: p };
    } else if (now >= from && now < to) {
      return { open: true, current: p };
    }
  }

  // Closed: report the next opening today, so the UI can say when.
  const upcoming = venue.periods
    .filter((p) => appliesOn(p, day) && minutes(p.from) > now)
    .sort((a, b) => minutes(a.from) - minutes(b.from));

  return upcoming.length ? { open: false, next: upcoming[0] } : { open: false };
}

/** Weekday for an instant, in the given IANA timezone. */
export function weekdayOf(instant: Date, timeZone: string): Weekday {
  const name = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone })
    .format(instant)
    .toLowerCase();
  return (WEEKDAYS.includes(name as Weekday) ? name : 'monday') as Weekday;
}

/** "HH:mm" for an instant, in the given IANA timezone. */
export function timeOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(instant);
}

/**
 * The discount rate that applies to a category, honouring per-category
 * overrides. Exported so the capture script and any UI agree on one rule.
 */
export function rateFor(menu: VenueMenu, categoryName: string): number {
  return menu.aiRateByCategory?.[categoryName] ?? menu.aiRate;
}

/** Price an all-inclusive guest pays, rounded to cents. */
export function discountedPrice(price: number, rate: number): number {
  return Math.round(price * (1 - rate) * 100) / 100;
}
