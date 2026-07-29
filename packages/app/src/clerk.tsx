import { useEffect } from 'react';
import { ClerkProvider, useAuth } from '@clerk/expo';
import * as SecureStore from 'expo-secure-store';
import { CLERK_PUBLISHABLE_KEY } from './config';
import { setTokenProvider } from './api';

/**
 * Clerk wiring.
 *
 * The session token is kept in the Keychain via expo-secure-store, so it
 * survives app updates and is not readable by other apps.
 */
const tokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      // Same reasoning as src/storage.ts: a Keychain read can fail before first
      // unlock, and throwing here would leave Clerk stuck initialising.
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      /* non-fatal; the session just will not persist */
    }
  },
};

/**
 * Bridges Clerk's hook-based `getToken` into the plain-module API client, which
 * is also called from the background task where no component tree exists.
 */
function TokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    setTokenProvider(async () => {
      if (!isSignedIn) return null;
      // Throws when offline; api.ts turns that into OfflineError rather than
      // signing the user out.
      return getToken();
    });
  }, [getToken, isSignedIn]);

  return <>{children}</>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      // Passed explicitly: env vars inside node_modules are not inlined in
      // production React Native builds, so Clerk cannot read it itself.
      publishableKey={CLERK_PUBLISHABLE_KEY}
      tokenCache={tokenCache}
    >
      <TokenBridge>{children}</TokenBridge>
    </ClerkProvider>
  );
}
