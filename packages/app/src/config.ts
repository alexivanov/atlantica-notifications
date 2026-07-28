import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  appGroup?: string;
};

export const API_URL = (extra.apiUrl ?? '').replace(/\/$/, '');
export const APP_GROUP = extra.appGroup ?? '';

/** Keys for SecureStore (Keychain) and the cache file. */
export const STORAGE = {
  deviceToken: 'atlantica.deviceToken',
  preferences: 'atlantica.preferences',
} as const;

export const CACHE_FILE = 'schedule-cache.json';

/** Fallback until the server tells us otherwise. */
export const DEFAULT_LEAD_MINUTES = 30;
