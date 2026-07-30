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
};

/**
 * Development-only CORS origin (e.g. "http://127.0.0.1:8100" for
 * `expo start --web`). Unset in production -- the native app uses platform
 * fetch, which has no same-origin policy.
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

/** Token for the ICS feed, since calendar clients cannot do OAuth. */
export const ICS_TOKEN = process.env.ICS_TOKEN ?? '';

/* ------------------------------------------------------------------ *
 * Clerk
 * ------------------------------------------------------------------ */

export const CLERK = {
  secretKey: process.env.CLERK_SECRET_KEY ?? '',
  /**
   * Clerk's JWKS public key (PEM). Supplying it lets tokens be verified
   * locally, with no Clerk round-trip on every request -- which matters because
   * this server is a single small machine and the app polls it on every
   * foreground.
   */
  jwtKey: process.env.CLERK_JWT_KEY ?? '',
  /** Optional; rejects tokens minted for a different frontend. */
  authorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

/**
 * Authorization allowlists.
 *
 * Clerk answers "who is this?"; these answer "are they allowed?". Clerk's own
 * Restricted sign-up mode is the primary gate, but a dashboard setting is easy
 * to change by accident, so the server keeps its own list. Ids are preferred
 * over emails: they are stable, and they keep personal data out of config.
 */
export const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * The "open it up later" switch. When true, anyone who can sign in through
 * Clerk is allowed. Off by default -- turning it on makes the schedule readable
 * by anyone who registers.
 */
export const OPEN_SIGNUP = process.env.OPEN_SIGNUP === 'true';

// Defined in @atlantica/shared so the server and the native app cannot drift.
export { CATEGORIES } from '@atlantica/shared';
export type { Category } from '@atlantica/shared';
