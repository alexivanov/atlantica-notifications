import { File, Paths } from 'expo-file-system';
import { deleteSecure, getSecure, setSecure } from './storage';
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

export async function getDeviceToken(): Promise<string | null> {
  return getSecure(STORAGE.deviceToken);
}

export async function setDeviceToken(token: string): Promise<void> {
  // Keychain-backed. Survives app updates, wiped on uninstall.
  await setSecure(STORAGE.deviceToken, token);
}

export async function clearDeviceToken(): Promise<void> {
  await deleteSecure(STORAGE.deviceToken);
}

export class AuthError extends Error {}

/**
 * Exchange an invite token for a long-lived device token.
 * The invite token itself is never stored -- only what the server issues back.
 */
export async function redeemInvite(
  inviteToken: string,
  label: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: inviteToken.trim(), label }),
  });

  if (res.status === 401) throw new AuthError('That invite link is not valid.');
  if (!res.ok) throw new Error(`Sign-in failed (HTTP ${res.status}).`);

  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('Server did not return a token.');

  await setDeviceToken(body.token);
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getDeviceToken();
  if (!token) throw new AuthError('Not signed in.');

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 401) {
    // The token was revoked or the server lost its state file. Drop it so the
    // UI falls back to the sign-in screen rather than looping on 401s.
    await clearDeviceToken();
    throw new AuthError('Session expired. Open your invite link again.');
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
    if (err instanceof AuthError) throw err;
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
