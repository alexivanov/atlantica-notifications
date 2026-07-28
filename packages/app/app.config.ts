import type { ExpoConfig } from 'expo/config';

/**
 * The API host the app talks to. Override per-build with EXPO_PUBLIC_API_URL
 * (e.g. in an EAS build profile) so a dev build can point at a laptop.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://atlantica-notifications.fly.dev';

// Shared with the widget target's config -- see identifiers.js.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BUNDLE_ID, APP_GROUP, APPLE_TEAM_ID, EAS_PROJECT_ID } =
  require('./identifiers.js') as {
    BUNDLE_ID: string;
    APP_GROUP: string;
    APPLE_TEAM_ID: string;
    EAS_PROJECT_ID: string;
  };

const config: ExpoConfig = {
  name: 'Atlantica',
  slug: 'atlantica-notifications',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'atlantica',
  // New Architecture is the default from SDK 57; no flag needed.
  userInterfaceStyle: 'dark',

  ios: {
    bundleIdentifier: BUNDLE_ID,
    // Required by @bacons/apple-targets to sign the widget extension.
    appleTeamId: APPLE_TEAM_ID,
    supportsTablet: false,
    infoPlist: {
      // Required for expo-background-task to re-arm reminders while the app is
      // backgrounded.
      UIBackgroundModes: ['processing'],
      BGTaskSchedulerPermittedIdentifiers: [
        'com.expo.modules.backgroundtask.processing',
      ],
    },
    entitlements: {
      // Shared container so the WidgetKit extension can read the schedule the
      // app writes. Widget extensions run in a separate process and cannot
      // reach the app's own storage.
      'com.apple.security.application-groups': [APP_GROUP],
    },
  },

  android: {
    package: BUNDLE_ID,
    permissions: [
      // Android 12+ requires this for alarms to fire at an exact time rather
      // than being batched into a maintenance window.
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ],
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-background-task',
    [
      'expo-notifications',
      {
        color: '#f2b880',
      },
    ],
    // Builds the Swift widget + Live Activity targets under ./targets.
    '@bacons/apple-targets',
  ],

  extra: {
    apiUrl: API_URL,
    appGroup: APP_GROUP,
    // Omitted entirely until set, so `eas init` reports a clear "not
    // configured" rather than chasing a bogus placeholder UUID.
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },

  experiments: {
    typedRoutes: true,
  },
};

export default config;
