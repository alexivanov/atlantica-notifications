import { useEffect } from 'react';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { StyleSheet, Text, View } from 'react-native';
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

/**
 * Shown instead of crashing when the build has no Clerk key.
 *
 * ClerkProvider throws on a missing publishableKey, which terminates the app on
 * launch with a raw RCTFatalException -- an easy build misconfiguration
 * (forgetting EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in an eas.json profile) turning
 * into a total, unexplained failure for whoever installs it.
 */
function MisconfiguredNotice() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Atlantica</Text>
      <Text style={styles.body}>
        This build was made without a Clerk publishable key, so sign-in cannot
        start.
      </Text>
      <Text style={styles.hint}>
        Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in the eas.json build profile and
        rebuild.
      </Text>
    </View>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) return <MisconfiguredNotice />;

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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#12152e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: { color: '#f2f3fa', fontSize: 28, fontWeight: '600', marginBottom: 14 },
  body: { color: '#f2f3fa', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  hint: {
    color: '#a2a7c8',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 14,
  },
});
