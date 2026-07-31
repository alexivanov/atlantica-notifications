import { useState } from 'react';
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
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { useSignInWithApple } from '@clerk/expo/apple';
import { useAuth } from '@clerk/expo';
// The classic create/attempt flow lives under /legacy in Clerk v4; the default
// export is the newer signals API. Legacy is the simpler fit for a plain
// email-code screen and is still supported.
import { useSignIn, useSignUp } from '@clerk/expo/legacy';
import { theme } from '../src/theme';

/**
 * Sign in with an email verification code, or Sign in with Apple.
 *
 * Sign-up is Restricted in the Clerk dashboard, so only invited addresses can
 * create an account -- and the server independently checks an allowlist, since
 * a dashboard setting is easy to change by accident.
 */
export default function SignInScreen() {
  const router = useRouter();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { isSignedIn, signOut } = useAuth();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Ask Clerk to email a one-time code. */
  async function sendCode() {
    if (!isLoaded || !signUpLoaded) return;
    const address = email.trim().toLowerCase();
    if (!address.includes('@')) {
      setError('That does not look like an email address.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await signIn.create({ identifier: address, strategy: 'email_code' });
      setStage('code');
    } catch (err) {
      // No existing account: try sign-up instead. Clerk rejects this when
      // sign-up is Restricted and the address was not invited, which is the
      // behaviour we want.
      try {
        await signUp.create({ emailAddress: address });
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setStage('code');
      } catch (signUpErr) {
        setError(clerkMessage(signUpErr) ?? clerkMessage(err) ?? 'Could not send a code.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!isLoaded || !signUpLoaded) return;
    setBusy(true);
    setError(null);
    try {
      // The code belongs to whichever flow was started above.
      const attempt = signIn.status
        ? await signIn.attemptFirstFactor({ strategy: 'email_code', code: code.trim() })
        : await signUp.attemptEmailAddressVerification({ code: code.trim() });

      const sessionId =
        'createdSessionId' in attempt ? attempt.createdSessionId : null;
      if (sessionId) {
        await setActive({ session: sessionId });
        router.replace('/');
      } else {
        setError('That code was not accepted.');
      }
    } catch (err) {
      setError(clerkMessage(err) ?? 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  async function signInWithApple() {
    setBusy(true);
    setError(null);
    try {
      const { createdSessionId, setActive: activate } =
        await startAppleAuthenticationFlow();
      if (createdSessionId && activate) {
        await activate({ session: createdSessionId });
        router.replace('/');
      }
    } catch (err) {
      setError(clerkMessage(err) ?? 'Sign in with Apple did not complete.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.h1}>Atlantica</Text>
      <Text style={styles.sub}>Imperial Resort</Text>

      {stage === 'email' ? (
        <>
          <Text style={styles.label}>Your email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!busy}
            onSubmitEditing={sendCode}
            returnKeyType="go"
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.btn, busy && styles.btnBusy]}
            onPress={sendCode}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#24180b" />
            ) : (
              <Text style={styles.btnText}>Email me a code</Text>
            )}
          </Pressable>

          {Platform.OS === 'ios' && (
            <>
              <Text style={styles.or}>or</Text>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                }
                cornerRadius={999}
                style={styles.apple}
                onPress={signInWithApple}
              />
            </>
          )}
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter the code we emailed you</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoFocus
            editable={!busy}
            onSubmitEditing={verifyCode}
            returnKeyType="go"
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.btn, busy && styles.btnBusy]}
            onPress={verifyCode}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#24180b" />
            ) : (
              <Text style={styles.btnText}>Continue</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              setStage('email');
              setCode('');
              setError(null);
            }}
          >
            <Text style={styles.link}>Use a different email</Text>
          </Pressable>
        </>
      )}

      <Text style={styles.hint}>
        Access is invite-only. If your address has not been invited, sign-in will
        not succeed.
      </Text>
    </KeyboardAvoidingView>
  );
}

/** Clerk errors carry a useful message a couple of levels down. */
function clerkMessage(err: unknown): string | null {
  const e = err as { errors?: { longMessage?: string; message?: string }[] };
  const first = e?.errors?.[0];
  return first?.longMessage ?? first?.message ?? null;
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
  codeInput: { fontSize: 22, letterSpacing: 6, textAlign: 'center' },
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
  or: {
    color: theme.muted,
    textAlign: 'center',
    marginVertical: 16,
    fontSize: 14,
  },
  apple: { height: 50 },
  link: {
    color: theme.accent,
    textAlign: 'center',
    marginTop: 18,
    fontSize: 15,
  },
  hint: { color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: 28 },
});
