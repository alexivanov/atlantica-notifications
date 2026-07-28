/**
 * All tunables in one place. Everything that could differ between local dev and
 * the deployed machine comes from the environment.
 */

/**
 * The resort's local timezone. Every date/time calculation in this app is done
 * explicitly in this zone and never in the host's local zone -- the server runs
 * in UTC, the guests are on resort time, and the kiosk site publishes bare
 * wall-clock times ("21:00") with no offset at all.
 *
 * Greece (Europe/Athens) and Cyprus (Europe/Nicosia) share identical EET/EEST
 * rules -- UTC+2 winter, UTC+3 summer, same DST transition dates -- so this
 * constant is correct for either Atlantica property.
 */
export const RESORT_TZ = process.env.RESORT_TZ ?? 'Europe/Athens';

const PROJECT = 'https://kioskcms.biz/template/hotel/project/91';

export const SOURCES = {
  /** Rolling ~7-day live entertainment schedule. The single source of truth --
   *  per-event detail pages add nothing beyond the title. */
  entertainment: `${PROJECT}/category/9252`,
  /** Page that embeds the daytime activities PDF; we scrape it only to detect
   *  when the resort swaps in a new PDF. */
  daytimePage: `${PROJECT}/category/1301/item/5200`,
};

/** Minutes before an event starts to fire the reminder. */
export const LEAD_MINUTES = Number(process.env.LEAD_MINUTES ?? 30);

/** How many days ahead to materialise recurring daytime activities. */
export const DAYTIME_HORIZON_DAYS = 7;

export const CRON = {
  /** Re-scrape the kiosk site. The schedule barely changes; this is mostly to
   *  pick up same-day edits and to notice the site breaking. */
  scrape: process.env.SCRAPE_CRON ?? '*/30 * * * *',
  /** Dispatch tick. MUST be finer-grained than LEAD_MINUTES, otherwise a
   *  reminder can only ever land on a coarse boundary and will often be late. */
  dispatch: process.env.DISPATCH_CRON ?? '* * * * *',
};

/**
 * Development-only CORS origin (e.g. "http://127.0.0.1:8100" for
 * `expo start --web`). Unset in production -- the native app uses platform
 * fetch, which has no same-origin policy, and the PWA is same-origin.
 */
export const DEV_ALLOW_ORIGIN = process.env.DEV_ALLOW_ORIGIN ?? '';

export const PORT = Number(process.env.PORT ?? 8080);
export const HOST = process.env.HOST ?? '0.0.0.0';

/** Where the JSON state file lives. On Fly this points at the mounted volume. */
export const DATA_DIR = process.env.DATA_DIR ?? './data';

/**
 * The hand-transcribed weekly daytime grid. Resolved from the working directory
 * (not import.meta.url) so the same path works from src/ and from dist/.
 */
export const SCHEDULE_FILE =
  process.env.SCHEDULE_FILE ?? './data/daytime-schedule.json';

/** Static assets for the PWA. Also working-directory relative. */
export const PUBLIC_DIR = process.env.PUBLIC_DIR ?? './public';

export const VAPID = {
  publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  subject: process.env.VAPID_SUBJECT ?? 'mailto:alexivanov97@gmail.com',
};

/**
 * Invite tokens -- one unguessable string per person, comma-separated.
 * Opening /s/<token> exchanges the token for a signed cookie.
 */
export const INVITE_TOKENS = (process.env.INVITE_TOKENS ?? '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

/** Separate token for the ICS feed, since calendar clients cannot hold cookies. */
export const ICS_TOKEN = process.env.ICS_TOKEN ?? '';

/** Secret used to sign the session cookie. */
export const COOKIE_SECRET = process.env.COOKIE_SECRET ?? '';

// Defined in @atlantica/shared so the server and the native app cannot drift.
export { CATEGORIES } from '@atlantica/shared';
export type { Category } from '@atlantica/shared';
