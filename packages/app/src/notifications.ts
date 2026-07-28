import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  MAX_SCHEDULED,
  reminderContent,
  selectReminders,
  type Occurrence,
} from '@atlantica/shared';
import { DEFAULT_LEAD_MINUTES } from './config';
import {
  fetchSchedule,
  getLocalPreferences,
  type Preferences,
} from './api';

/**
 * On-device reminder scheduling.
 *
 * This is the whole reason for going native. Reminders are local alarms owned
 * by the OS: no APNs, no push certificates, no server in the delivery path, and
 * they fire with the phone in airplane mode. The server's only job is to say
 * *what* is on; the phone decides when to ring.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Local notifications exist on iOS and Android but not on web, where
 * `expo start --web` is only used for UI development.
 *
 * Every entry point below degrades rather than throwing: a failure in the
 * notification layer should never take down the screen the user is looking at,
 * and on a real device it is far better to show "0 reminders set" than a red
 * error box.
 */
const NOTIFICATIONS_SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

export async function getPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (!NOTIFICATIONS_SUPPORTED) return 'denied';
  const settings = await Notifications.getPermissionsAsync();
  // On iOS the root `status` collapses provisional/ephemeral grants; the ios
  // sub-object is the accurate one.
  if (Platform.OS === 'ios' && settings.ios) {
    const s = settings.ios.status;
    if (s === Notifications.IosAuthorizationStatus.AUTHORIZED) return 'granted';
    if (s === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
    if (s === Notifications.IosAuthorizationStatus.NOT_DETERMINED) return 'undetermined';
    return 'denied';
  }
  if (settings.granted) return 'granted';
  return settings.canAskAgain ? 'undetermined' : 'denied';
}

/** Must be called from a real user gesture. */
export async function requestPermission(): Promise<boolean> {
  if (!NOTIFICATIONS_SUPPORTED) return false;
  const res = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  if (Platform.OS === 'ios' && res.ios) {
    return (
      res.ios.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
      res.ios.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  }
  return res.granted;
}

export interface ArmResult {
  scheduled: number;
  droppedForCapacity: number;
  coversUntil: Date | null;
  skippedReason?: 'no-permission';
}

/**
 * Cancel everything and reschedule from the current schedule.
 *
 * Cancel-and-rebuild rather than diffing: with at most ~55 alarms the cost is
 * trivial, and it is naturally idempotent, so a re-arm racing with a
 * background refresh cannot produce duplicates or orphans.
 */
export async function armReminders(
  occurrences: Occurrence[],
  opts: { leadMinutes?: number; preferences?: Preferences } = {},
): Promise<ArmResult> {
  if ((await getPermissionStatus()) !== 'granted') {
    return {
      scheduled: 0,
      droppedForCapacity: 0,
      coversUntil: null,
      skippedReason: 'no-permission',
    };
  }

  const preferences = opts.preferences ?? (await getLocalPreferences());
  const leadMinutes = opts.leadMinutes ?? DEFAULT_LEAD_MINUTES;

  const plan = selectReminders(occurrences, {
    leadMinutes,
    enabled: preferences,
  });

  await cancelAll();

  let scheduled = 0;
  for (const entry of plan.entries) {
    const { title, body } = reminderContent(entry.occurrence, entry.fireAt);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          data: {
            key: entry.occurrence.key,
            category: entry.occurrence.category,
            // Stored because reading the fire time back off the trigger is
            // platform-specific and unreliable -- iOS turns a DATE trigger into
            // calendar components or a time interval depending on version. We
            // already know the exact instant here, so record it.
            fireAt: entry.fireAt.toISOString(),
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: entry.fireAt,
        },
      });
      scheduled++;
    } catch (err) {
      // One bad entry must not abandon the rest of the schedule.
      console.warn(
        `[notifications] could not schedule "${entry.occurrence.title}":`,
        (err as Error).message,
      );
    }
  }

  return {
    scheduled,
    droppedForCapacity: plan.droppedForCapacity,
    coversUntil: plan.coversUntil,
  };
}

/** Fetch the latest schedule (or cache) and re-arm from it. */
export async function refreshAndArm(): Promise<ArmResult & { fromCache: boolean }> {
  const [{ payload, fromCache }, preferences] = await Promise.all([
    fetchSchedule(),
    getLocalPreferences(),
  ]);

  const result = await armReminders(payload.occurrences, {
    leadMinutes: payload.leadMinutes ?? DEFAULT_LEAD_MINUTES,
    preferences,
  });

  return { ...result, fromCache };
}

/** What is actually queued with the OS -- the ground truth for diagnostics. */
export async function listScheduled(): Promise<
  { id: string; title: string; fireAt: Date | null }[]
> {
  if (!NOTIFICATIONS_SUPPORTED) return [];
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    return pending.map((n) => {
      // Prefer what we recorded at schedule time; fall back to interrogating
      // the trigger for anything scheduled by an older build.
      const stored = (n.content.data as { fireAt?: string } | undefined)?.fireAt;
      const fromData = stored ? new Date(stored) : null;
      return {
        id: n.identifier,
        title: n.content.title ?? '(no title)',
        fireAt:
          fromData && !Number.isNaN(fromData.getTime())
            ? fromData
            : triggerDate(n.trigger),
      };
    });
  } catch (err) {
    console.warn('[notifications] could not list pending:', (err as Error).message);
    return [];
  }
}

/**
 * Recover the fire time from a pending notification.
 *
 * The shape differs by platform: a DATE trigger becomes a UNCalendarNotification
 * on iOS and comes back as `dateComponents`, while Android reports a numeric
 * `value`. Reading only `value` silently yielded null on iOS, which surfaced in
 * the UI as "--:--" and made correctly-scheduled reminders look broken.
 */
function triggerDate(trigger: unknown): Date | null {
  if (!trigger || typeof trigger !== 'object') return null;
  const t = trigger as {
    value?: number | string;
    date?: number | string;
    dateComponents?: {
      year?: number;
      month?: number;
      day?: number;
      hour?: number;
      minute?: number;
      second?: number;
    };
  };

  for (const raw of [t.value, t.date]) {
    if (typeof raw === 'number') return new Date(raw);
    if (typeof raw === 'string') {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // A time-interval trigger only knows "n seconds from when it was set", so the
  // absolute time is unrecoverable after the fact -- another reason the fire
  // time is now stored in the notification's data.
  const ti = trigger as { seconds?: number; repeats?: boolean };
  if (typeof ti.seconds === 'number' && !ti.repeats) {
    return null;
  }

  const c = t.dateComponents;
  if (c && c.year && c.month && c.day) {
    // `month` is 1-based here, unlike the Date constructor.
    return new Date(
      c.year,
      c.month - 1,
      c.day,
      c.hour ?? 0,
      c.minute ?? 0,
      c.second ?? 0,
    );
  }

  return null;
}

export async function cancelAll(): Promise<void> {
  if (!NOTIFICATIONS_SUPPORTED) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn('[notifications] cancel failed:', (err as Error).message);
  }
}

export { MAX_SCHEDULED };
