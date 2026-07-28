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
  return (NativeModules.AtlanticaWidget as LiveActivityBridge | undefined) ?? null;
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

/** Start a countdown for an event, if Live Activities are available. */
export async function startLiveActivity(occ: Occurrence): Promise<string | null> {
  const native = liveActivities();
  if (!native) return null;

  try {
    if (!(await native.areLiveActivitiesEnabled())) return null;
    return await native.startLiveActivity(
      JSON.stringify({
        title: occ.title,
        venue: occ.venue ?? '',
        startsAt: occ.startsAt,
      }),
    );
  } catch (err) {
    console.warn('[liveactivity] start failed:', (err as Error).message);
    return null;
  }
}

export async function endLiveActivity(id: string): Promise<void> {
  const native = liveActivities();
  if (!native) return;
  try {
    await native.endLiveActivity(id);
  } catch {
    // Ending a stale activity is not worth surfacing.
  }
}

/**
 * Start a Live Activity for the next event if it is close enough to be useful.
 * Two hours out is roughly "you should think about heading over".
 */
export async function maybeStartLiveActivityForNext(
  occurrences: Occurrence[],
  withinMinutes = 120,
): Promise<string | null> {
  const preferences = await getLocalPreferences();
  const [next] = selectUpcoming(occurrences, { enabled: preferences, limit: 1 });
  if (!next) return null;

  const minsAway = (new Date(next.startsAt).getTime() - Date.now()) / 60_000;
  if (minsAway > withinMinutes) return null;

  return startLiveActivity(next);
}
