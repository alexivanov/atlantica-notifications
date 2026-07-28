import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { AuthError, redeemInvite } from '../src/api';
import { theme } from '../src/theme';

/**
 * One-time sign-in.
 *
 * The same invite links that work for the PWA (`https://host/s/<token>`) are
 * accepted here, either by pasting the whole URL or by opening
 * `atlantica://s/<token>` on the phone -- so there is one link to send a person,
 * not two.
 */
export default function SignInScreen() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(raw: string) {
    const token = extractToken(raw);
    if (!token) {
      setError('That does not look like an invite link.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await redeemInvite(token, deviceLabel());
      router.replace('/');
    } catch (err) {
      setError(
        err instanceof AuthError
          ? err.message
          : `Could not sign in: ${(err as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  // Handle the app being opened via a deep link, both cold and warm.
  useEffect(() => {
    let cancelled = false;

    Linking.getInitialURL().then((url) => {
      if (!cancelled && url) {
        const token = extractToken(url);
        if (token) void submit(url);
      }
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      const token = extractToken(url);
      if (token) void submit(url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.h1}>Atlantica</Text>
      <Text style={styles.sub}>Imperial Resort</Text>

      <Text style={styles.label}>Paste your invite link</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        placeholder="https://…/s/your-token"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        onSubmitEditing={() => submit(value)}
        returnKeyType="go"
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.btn, busy && styles.btnBusy]}
        onPress={() => submit(value)}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#24180b" />
        ) : (
          <Text style={styles.btnText}>Continue</Text>
        )}
      </Pressable>

      <Text style={styles.hint}>
        You only need to do this once. Opening your invite link on this phone
        works too.
      </Text>
    </KeyboardAvoidingView>
  );
}

/**
 * Accepts a bare token, an `atlantica://s/<token>` deep link, or the full
 * `https://host/s/<token>` invite URL -- whichever the person happens to have.
 */
export function extractToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/\/s\/([A-Za-z0-9_\-]+)/);
  if (match) return match[1];

  // A bare token pasted on its own.
  if (/^[A-Za-z0-9_\-]{16,}$/.test(trimmed)) return trimmed;

  return null;
}

function deviceLabel(): string {
  return Platform.OS === 'ios' ? 'iPhone' : 'Android';
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    padding: 24,
    justifyContent: 'center',
  },
  h1: { color: theme.ink, fontSize: 34, fontWeight: '600' },
  sub: { color: theme.muted, fontSize: 16, marginTop: 2, marginBottom: 40 },
  label: { color: theme.ink, fontSize: 15, marginBottom: 8 },
  input: {
    backgroundColor: theme.card,
    color: theme.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  error: { color: theme.warn, marginTop: 12, fontSize: 14, lineHeight: 19 },
  btn: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  btnBusy: { opacity: 0.7 },
  btnText: { color: '#24180b', fontSize: 16, fontWeight: '700' },
  hint: { color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: 24 },
});
