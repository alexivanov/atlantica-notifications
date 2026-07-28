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

export async function getSecure(key: string): Promise<string | null> {
  if (isWeb) return webStore.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function setSecure(key: string, value: string): Promise<void> {
  if (isWeb) return webStore.setItem(key, value);
  return SecureStore.setItemAsync(key, value);
}

export async function deleteSecure(key: string): Promise<void> {
  if (isWeb) return webStore.removeItem(key);
  return SecureStore.deleteItemAsync(key);
}
