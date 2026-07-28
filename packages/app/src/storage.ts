import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Small secure-storage wrapper.
 *
 * On iOS and Android this is the Keychain / EncryptedSharedPreferences via
 * expo-secure-store -- the real storage for the device token.
 *
 * expo-secure-store has no web implementation, so `expo start --web` would
 * throw on the very first call. Web is not a shipping target, but being able
 * to run the UI in a browser is worth a lot during development, so web falls
 * back to localStorage. That fallback is explicitly NOT secure, and it never
 * runs on a real device.
 */

const webStore = {
  getItem(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private browsing, quota, etc. */
    }
  },
  removeItem(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const isWeb = Platform.OS === 'web';

/**
 * Reads never throw.
 *
 * A Keychain read can genuinely fail -- before the device's first unlock, or
 * when entitlements are not applied (as in an unsigned simulator build). An
 * unhandled rejection here leaves the app stuck on its loading spinner with no
 * way out. Treating a failed read as "no value" degrades to the sign-in screen,
 * which the user can actually recover from.
 */
export async function getSecure(key: string): Promise<string | null> {
  try {
    if (isWeb) return webStore.getItem(key);
    return await SecureStore.getItemAsync(key);
  } catch (err) {
    console.warn(`[storage] could not read "${key}":`, (err as Error).message);
    return null;
  }
}

/** Returns false if the value could not be persisted, so callers can react. */
export async function setSecure(key: string, value: string): Promise<boolean> {
  try {
    if (isWeb) {
      webStore.setItem(key, value);
      return true;
    }
    await SecureStore.setItemAsync(key, value);
    return true;
  } catch (err) {
    console.warn(`[storage] could not write "${key}":`, (err as Error).message);
    return false;
  }
}

export async function deleteSecure(key: string): Promise<void> {
  try {
    if (isWeb) return webStore.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing useful to do; the caller is signing out either way.
  }
}
