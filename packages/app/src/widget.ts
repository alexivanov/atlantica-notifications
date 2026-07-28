import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { ExtensionStorage } from '@bacons/apple-targets';
import { selectUpcoming, type Occurrence } from '@atlantica/shared';
import { APP_GROUP, STORAGE } from './config';
import { getLocalPreferences, readCache } from './api';
import { deleteSecure, getSecure, setSecure } from './storage';

/**
 * Feeds the iOS home screen widget and Live Activity.
 *
 * Widget extensions run in their own process and cannot read the app's storage,
 * so the shared App Group container is the only channel. The app writes a small
 * JSON blob of the next few events; the widget reads it on its own timeline.
 *
 * Storage and timeline reloads come from @bacons/apple-targets' ExtensionStorage
 * (already linked by the config plugin). Only ActivityKit needs custom native
 * code, which is why the local module is as small as it is.
 */

interface LiveActivityBridge {
  startLiveActivity(payload: string): Promise<string | null>;
  endLiveActivity(id: string): Promise<void>;
  endAllLiveActivities(): Promise<void>;
  activeActivityIds(): Promise<string[]>;
  areLiveActivitiesEnabled(): Promise<boolean>;
}

/**
 * Resolved lazily and defensively: the native module only exists in a custom
 * dev client or a real build, never in Expo Go, and never on Android.
 *
 * Must go through requireOptionalNativeModule, NOT react-native's
 * `NativeModules`. Expo Modules are not registered on the legacy bridge at all,
 * so `NativeModules.AtlanticaLiveActivity` is always undefined -- which read
 * identically to "Live Activities unavailable" and hid the real problem.
 * The "optional" variant returns null rather than throwing when absent, which
 * keeps the graceful degradation off-iOS.
 */
let cached: LiveActivityBridge | null | undefined;

function liveActivities(): LiveActivityBridge | null {
  if (Platform.OS !== 'ios') return null;
  if (cached === undefined) {
    cached = requireOptionalNativeModule<LiveActivityBridge>('AtlanticaLiveActivity');
    if (!cached) {
      console.warn(
        '[liveactivity] native module "AtlanticaLiveActivity" not found -- ' +
          'this build predates it, or the pod was not linked.',
      );
    }
  }
  return cached;
}

export const WIDGET_KEY = 'upcoming';

export interface WidgetPayload {
  updatedAt: string;
  events: {
    title: string;
    startsAt: string;
    startTime: string;
    venue: string | null;
    category: string;
  }[];
}

/**
 * Write the next few events into the shared container and nudge WidgetKit.
 * Safe to call anywhere -- it no-ops off iOS or when the group is unset.
 */
export async function syncWidgetData(occurrences?: Occurrence[]): Promise<void> {
  if (Platform.OS !== 'ios' || !APP_GROUP) return;

  let list = occurrences;
  if (!list) {
    const cached = await readCache();
    list = cached?.payload.occurrences ?? [];
  }

  const preferences = await getLocalPreferences();
  const upcoming = selectUpcoming(list, { enabled: preferences, limit: 6 });

  const payload: WidgetPayload = {
    updatedAt: new Date().toISOString(),
    events: upcoming.map((o) => ({
      title: o.title,
      startsAt: o.startsAt,
      startTime: o.startTime,
      venue: o.venue,
      category: o.category,
    })),
  };

  try {
    const storage = new ExtensionStorage(APP_GROUP);
    // Stored as a JSON string; SharedModel.swift decodes the same shape.
    storage.set(WIDGET_KEY, JSON.stringify(payload));
    ExtensionStorage.reloadWidget();
  } catch (err) {
    console.warn('[widget] sync failed:', (err as Error).message);
  }
}

/* ------------------------------------------------------------------ *
 * Live Activity
 * ------------------------------------------------------------------ */

/**
 * The activity currently on screen, so repeated calls do not stack duplicates.
 *
 * Module-level rather than React state because this is called from the
 * schedule screen on every foreground, and from settings -- both must see the
 * same activity.
 */
let current: { id: string; occurrenceKey: string } | null = null;

/** The occurrence key currently being tracked, if any. */
export function currentLiveActivity(): string | null {
  return current?.occurrenceKey ?? null;
}

/**
 * Re-attach to a countdown started before the app was last killed.
 *
 * `current` is module state and dies with the process, but the Live Activity
 * itself outlives it. Without this, a countdown from a previous launch shows on
 * the Lock Screen while the app believes nothing is tracked -- the star reads
 * empty and there is no way to stop it.
 */
export async function restoreLiveActivity(): Promise<string | null> {
  const native = liveActivities();
  if (!native) return null;

  try {
    const ids = await native.activeActivityIds();
    if (ids.length === 0) {
      current = null;
      await deleteSecure(STORAGE.liveActivity);
      return null;
    }

    const saved = await getSecure(STORAGE.liveActivity);
    const parsed = saved
      ? (JSON.parse(saved) as { id: string; occurrenceKey: string })
      : null;

    if (parsed && ids.includes(parsed.id)) {
      current = parsed;
      return parsed.occurrenceKey;
    }

    // Something is running that we cannot map back to an event -- most likely
    // left over from an older build. Clear it rather than stranding it.
    await native.endAllLiveActivities();
    current = null;
    await deleteSecure(STORAGE.liveActivity);
    return null;
  } catch (err) {
    console.warn('[liveactivity] restore failed:', (err as Error).message);
    return null;
  }
}

export async function liveActivitiesAvailable(): Promise<boolean> {
  const native = liveActivities();
  if (!native) return false;
  try {
    return await native.areLiveActivitiesEnabled();
  } catch {
    return false;
  }
}

/** Start a countdown for an event, if Live Activities are available. */
export async function startLiveActivity(occ: Occurrence): Promise<string | null> {
  const native = liveActivities();
  if (!native) return null;

  // Already showing this exact event -- starting again would stack a duplicate
  // on the Lock Screen.
  if (current?.occurrenceKey === occ.key) return current.id;

  try {
    if (!(await native.areLiveActivitiesEnabled())) return null;

    // Only one countdown makes sense at a time; retire the previous event's.
    if (current) await endLiveActivity(current.id);

    const id = await native.startLiveActivity(
      JSON.stringify({
        title: occ.title,
        venue: occ.venue ?? '',
        startsAt: occ.startsAt,
      }),
    );
    current = id ? { id, occurrenceKey: occ.key } : null;
    // Persisted so the star still reflects reality, and the countdown can
    // still be stopped, after the app is killed and reopened.
    if (current) await setSecure(STORAGE.liveActivity, JSON.stringify(current));
    return id;
  } catch (err) {
    console.warn('[liveactivity] start failed:', (err as Error).message);
    return null;
  }
}

export async function endLiveActivity(id?: string): Promise<void> {
  const native = liveActivities();
  const target = id ?? current?.id;
  if (!native || !target) return;
  try {
    await native.endLiveActivity(target);
  } catch {
    // Ending a stale activity is not worth surfacing.
  } finally {
    if (!id || id === current?.id) {
      current = null;
      await deleteSecure(STORAGE.liveActivity);
    }
  }
}

/**
 * Clear a countdown whose event has already started.
 *
 * The system dismisses it on its own for events that were within four hours
 * when tracking began (see the native module), so this covers the rest: an
 * event tracked further ahead than that, where only the app can tidy up.
 */
export async function pruneStaleLiveActivity(
  occurrences: Occurrence[],
): Promise<void> {
  if (Platform.OS !== 'ios' || !current) return;

  const tracked = occurrences.find((o) => o.key === current!.occurrenceKey);
  // Either the event is gone from the schedule, or it has already begun.
  if (!tracked || new Date(tracked.startsAt).getTime() <= Date.now()) {
    await endLiveActivity();
  }
}
