import { NativeModules, Platform } from 'react-native';
import { ExtensionStorage } from '@bacons/apple-targets';
import { selectUpcoming, type Occurrence } from '@atlantica/shared';
import { APP_GROUP } from './config';
import { getLocalPreferences, readCache } from './api';

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
  areLiveActivitiesEnabled(): Promise<boolean>;
}

/**
 * Resolved lazily and defensively: the native module only exists in a custom
 * dev client or a real build, never in Expo Go, and never on Android.
 */
function liveActivities(): LiveActivityBridge | null {
  if (Platform.OS !== 'ios') return null;
  return (NativeModules.AtlanticaLiveActivity as LiveActivityBridge | undefined) ?? null;
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

export function currentLiveActivity(): string | null {
  return current?.occurrenceKey ?? null;
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
    if (!id || id === current?.id) current = null;
  }
}

/**
 * Start a Live Activity for the next event if it is close enough to be useful.
 * Two hours out is roughly "you should think about heading over".
 *
 * Called on every foreground and refresh; idempotent, and retires the countdown
 * once its event has started.
 */
export async function maybeStartLiveActivityForNext(
  occurrences: Occurrence[],
  withinMinutes = 120,
): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;

  const preferences = await getLocalPreferences();
  const [next] = selectUpcoming(occurrences, { enabled: preferences, limit: 1 });

  if (!next) {
    if (current) await endLiveActivity();
    return null;
  }

  const minsAway = (new Date(next.startsAt).getTime() - Date.now()) / 60_000;
  if (minsAway > withinMinutes) {
    // The showing activity is for an event that has since passed.
    if (current && current.occurrenceKey !== next.key) await endLiveActivity();
    return null;
  }

  return startLiveActivity(next);
}
