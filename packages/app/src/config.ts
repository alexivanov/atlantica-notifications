import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  appGroup?: string;
  clerkPublishableKey?: string;
};

export const API_URL = (extra.apiUrl ?? '').replace(/\/$/, '');
export const APP_GROUP = extra.appGroup ?? '';

/** Clerk publishable key, resolved from app config rather than process.env. */
export const CLERK_PUBLISHABLE_KEY = extra.clerkPublishableKey ?? '';

/** Keys for SecureStore (Keychain) and the cache file. */
export const STORAGE = {
  deviceToken: 'atlantica.deviceToken',
  preferences: 'atlantica.preferences',
  liveActivity: 'atlantica.liveActivity',
} as const;

export const CACHE_FILE = 'schedule-cache.json';

/** Fallback until the server tells us otherwise. */
export const DEFAULT_LEAD_MINUTES = 30;
