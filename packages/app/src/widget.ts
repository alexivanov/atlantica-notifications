import { NativeModules, Platform } from 'react-native';
import { selectUpcoming, type Occurrence } from '@atlantica/shared';
import { APP_GROUP } from './config';
import { getLocalPreferences, readCache } from './api';

/**
 * Feeds the iOS home screen widget and Live Activity.
 *
 * Widget extensions run in their own process and cannot read the app's storage,
 * so the shared App Group container is the only channel. The app writes a small
 * JSON blob of the next few events; the widget reads it on its own timeline.
 */

interface WidgetBridge {
  setItem(key: string, value: string, appGroup: string): Promise<void>;
  reloadAllTimelines(): Promise<void>;
  startLiveActivity(payload: string): Promise<string | null>;
  endLiveActivity(id: string): Promise<void>;
  areLiveActivitiesEnabled(): Promise<boolean>;
}

/**
 * Resolved lazily and defensively: the native module only exists in a custom
 * dev client or a real build, never in Expo Go, and never on Android.
 */
function bridge(): WidgetBridge | null {
  if (Platform.OS !== 'ios') return null;
  return (NativeModules.AtlanticaWidget as WidgetBridge | undefined) ?? null;
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
 * Safe to call anywhere -- it no-ops when the native module is absent.
 */
export async function syncWidgetData(occurrences?: Occurrence[]): Promise<void> {
  const native = bridge();
  if (!native) return;

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
    await native.setItem(WIDGET_KEY, JSON.stringify(payload), APP_GROUP);
    await native.reloadAllTimelines();
  } catch (err) {
    console.warn('[widget] sync failed:', (err as Error).message);
  }
}

/* ------------------------------------------------------------------ *
 * Live Activity
 * ------------------------------------------------------------------ */

/** Start a countdown for an event, if Live Activities are available. */
export async function startLiveActivity(occ: Occurrence): Promise<string | null> {
  const native = bridge();
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
  const native = bridge();
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
