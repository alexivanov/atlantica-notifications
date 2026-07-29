import { File, Paths } from 'expo-file-system';
import { getSecure, setSecure } from './storage';
import type { Category, SchedulePayload } from '@atlantica/shared';
import { API_URL, CACHE_FILE, STORAGE } from './config';

/**
 * Talks to the scraper backend, and keeps the last good response on disk.
 *
 * Offline behaviour is the point here: at a resort, wifi is patchy and roaming
 * may be off. The list must render from cache instantly, and a failed refresh
 * must never blank the screen -- the previously fetched schedule is still the
 * best information available.
 */

/* ------------------------------------------------------------------ *
 * Credentials
 * ------------------------------------------------------------------ */

/**
 * Supplies a Clerk session token.
 *
 * Injected rather than imported because Clerk's `getToken` comes from a React
 * hook, while this module is also used from a background task where no
 * component tree exists.
 */
type TokenProvider = () => Promise<string | null>;

let getAuthToken: TokenProvider = async () => null;

export function setTokenProvider(fn: TokenProvider): void {
  getAuthToken = fn;
}

/** Signed in, but the server says this account is not on the allowlist. */
export class ForbiddenError extends Error {}

/** Not signed in, or the session is genuinely invalid. */
export class AuthError extends Error {}

/**
 * Could not obtain a token -- almost always no network.
 *
 * Kept distinct from AuthError on purpose: treating a failed refresh as "signed
 * out" would log someone out every time the resort wifi drops, which is exactly
 * when they are using the app.
 */
export class OfflineError extends Error {}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token: string | null = null;
  try {
    token = await getAuthToken();
  } catch {
    throw new OfflineError('could not refresh session');
  }
  if (!token) throw new OfflineError('no session token available');

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  // 403 means Clerk authenticated them and the server declined -- a different
  // problem from being signed out, and signing them out would not fix it.
  if (res.status === 403) {
    throw new ForbiddenError('This account does not have access.');
  }
  if (res.status === 401) {
    throw new AuthError('Session expired. Please sign in again.');
  }

  return res;
}

/* ------------------------------------------------------------------ *
 * Schedule, with an on-disk cache
 * ------------------------------------------------------------------ */

interface CachedSchedule {
  etag: string | null;
  fetchedAt: string;
  payload: SchedulePayload;
}

/**
 * `Paths.document` persists across launches, unlike the cache directory which
 * the OS may purge under storage pressure -- losing the offline schedule
 * exactly when a phone is full and roaming is off would be the worst time.
 */
function cacheFile(): File {
  return new File(Paths.document, CACHE_FILE);
}

export async function readCache(): Promise<CachedSchedule | null> {
  try {
    const file = cacheFile();
    if (!file.exists) return null;
    return JSON.parse(await file.text()) as CachedSchedule;
  } catch {
    return null;
  }
}

async function writeCache(entry: CachedSchedule): Promise<void> {
  try {
    const file = cacheFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(entry));
  } catch {
    // A failed cache write is not worth surfacing -- the app still works, it
    // just won't have offline data next launch.
  }
}

export interface FetchResult {
  payload: SchedulePayload;
  /** True when this came from disk because the network was unavailable. */
  fromCache: boolean;
  fetchedAt: string;
}

/**
 * Fetch the schedule, falling back to cache.
 *
 * Sends If-None-Match so an unchanged schedule costs a 304 rather than a full
 * download -- this runs on every foreground and every background re-arm.
 */
export async function fetchSchedule(): Promise<FetchResult> {
  const cached = await readCache();

  try {
    const res = await authedFetch('/api/schedule', {
      headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
    });

    if (res.status === 304 && cached) {
      return {
        payload: cached.payload,
        fromCache: false,
        fetchedAt: cached.fetchedAt,
      };
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const payload = (await res.json()) as SchedulePayload;
    const entry: CachedSchedule = {
      etag: res.headers.get('etag'),
      fetchedAt: new Date().toISOString(),
      payload,
    };
    await writeCache(entry);

    return { payload, fromCache: false, fetchedAt: entry.fetchedAt };
  } catch (err) {
    // Auth problems must surface; anything else falls back to cache.
    if (err instanceof AuthError || err instanceof ForbiddenError) throw err;
    if (cached) {
      return {
        payload: cached.payload,
        fromCache: true,
        fetchedAt: cached.fetchedAt,
      };
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

export type Preferences = Record<Category, boolean>;

export const DEFAULT_PREFERENCES: Preferences = {
  entertainment: true,
  daytime: true,
};

/**
 * Read preferences locally first so the UI and the notification scheduler work
 * offline; the server copy is the sync point between the two phones.
 */
export async function getLocalPreferences(): Promise<Preferences> {
  try {
    const raw = await getSecure(STORAGE.preferences);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function setLocalPreferences(prefs: Preferences): Promise<void> {
  await setSecure(STORAGE.preferences, JSON.stringify(prefs));
}

export async function pushPreferences(prefs: Preferences): Promise<void> {
  await setLocalPreferences(prefs);
  try {
    await authedFetch('/api/preferences', {
      method: 'POST',
      body: JSON.stringify({ enabled: prefs }),
    });
  } catch {
    // Local copy already saved; the server will catch up next time. Reminders
    // are scheduled on-device, so this failing changes nothing about whether
    // they fire.
  }
}

export interface ServerConfig {
  leadMinutes: number;
  timezone: string;
  enabled: Preferences;
}

export async function fetchServerConfig(): Promise<ServerConfig | null> {
  try {
    const res = await authedFetch('/api/config');
    if (!res.ok) return null;
    return (await res.json()) as ServerConfig;
  } catch {
    return null;
  }
}
