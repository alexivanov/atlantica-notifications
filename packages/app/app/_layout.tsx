import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from '../src/theme';
import { AuthProvider } from '../src/clerk';
import { registerBackgroundRearm } from '../src/backgroundTask';

export default function RootLayout() {
  useEffect(() => {
    // Registered once at startup; the task itself is defined at module scope in
    // backgroundTask.ts, as expo-task-manager requires.
    void registerBackgroundRearm();
  }, []);

  return (
    <AuthProvider>
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        {/* The tab bar owns its own headers. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Reminders' }} />
        <Stack.Screen name="signin" options={{ title: 'Sign in', headerShown: false }} />
        <Stack.Screen name="dining-info" options={{ title: 'Good to know' }} />
        <Stack.Screen name="venue/[slug]/index" options={{ title: 'Venue' }} />
        <Stack.Screen name="venue/[slug]/[cat]" options={{ title: 'Menu' }} />
      </Stack>
    </SafeAreaProvider>
    </AuthProvider>
  );
}
