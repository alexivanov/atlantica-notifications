import type { Category, Occurrence } from './types.js';

/**
 * Decides which occurrences get an on-device alarm.
 *
 * ## Why this exists
 *
 * iOS keeps only the **64 soonest-firing** pending local notifications per app
 * and silently discards the rest -- no error, no warning, the tail simply never
 * fires. A single week at this resort is ~63 occurrences (15 entertainment +
 * 48 daytime), which sits right on that limit. Scheduling "everything" would
 * therefore appear to work while quietly dropping whichever reminders happened
 * to sort last.
 *
 * So the client never schedules blindly: it takes the soonest N that fit under
 * a deliberate cap, and re-arms as time passes and slots free up.
 *
 * This is the one piece of real client-side logic worth sharing between iOS and
 * Android, so it lives here as a pure function with no platform imports.
 */

/**
 * Headroom under the iOS limit of 64. The gap absorbs anything else that might
 * occupy a slot (a re-arm racing with a fire, a future digest notification)
 * without pushing a real reminder off the end.
 */
export const MAX_SCHEDULED = 55;

/** iOS's hard cap, for reference and for tests to assert we stay under it. */
export const IOS_PENDING_LIMIT = 64;

export interface ReminderPlanEntry {
  occurrence: Occurrence;
  /** Absolute instant the notification should fire. */
  fireAt: Date;
  /** Stable identifier so re-arming is idempotent. */
  id: string;
}

export interface ReminderPlan {
  entries: ReminderPlanEntry[];
  /**
   * Occurrences that were eligible but did not fit under the cap. Not an error
   * -- they get scheduled on a later re-arm -- but surfaced so the UI can say
   * how far ahead reminders are currently armed.
   */
  droppedForCapacity: number;
  /** The last instant covered by this plan, or null when nothing is armed. */
  coversUntil: Date | null;
}

export interface SelectOptions {
  /** Minutes before the start time to fire. */
  leadMinutes: number;
  /** Per-category mute switches. */
  enabled: Record<Category, boolean>;
  /** Injectable clock for testing. */
  now?: Date;
  /** Override the cap, mainly for tests. */
  max?: number;
}

export function selectReminders(
  occurrences: Occurrence[],
  opts: SelectOptions,
): ReminderPlan {
  const now = opts.now ?? new Date();
  const max = opts.max ?? MAX_SCHEDULED;
  const leadMs = opts.leadMinutes * 60_000;

  const eligible: ReminderPlanEntry[] = [];

  for (const occ of occurrences) {
    if (!opts.enabled[occ.category]) continue;

    const start = new Date(occ.startsAt);
    // Guards against a malformed startsAt reaching the notification API, where
    // an Invalid Date would either throw or schedule something nonsensical.
    if (Number.isNaN(start.getTime())) continue;

    // Already started: a reminder now is noise, not a reminder.
    if (start.getTime() <= now.getTime()) continue;

    const fireAt = new Date(start.getTime() - leadMs);

    // The event is closer than the lead time. Firing immediately would be
    // startling and, for a batch re-arm, would produce a burst. Skip it -- the
    // same rule the server-side dispatcher uses.
    if (fireAt.getTime() <= now.getTime()) continue;

    eligible.push({ occurrence: occ, fireAt, id: occ.key });
  }

  // Soonest first, so the cap keeps what matters most.
  eligible.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());

  const entries = eligible.slice(0, max);

  return {
    entries,
    droppedForCapacity: eligible.length - entries.length,
    coversUntil: entries.length
      ? entries[entries.length - 1].fireAt
      : null,
  };
}

/**
 * The next few occurrences to surface in the home screen widget.
 * Same filtering as reminders, but ignores lead time -- a widget shows what is
 * on, including something starting in five minutes.
 */
export function selectUpcoming(
  occurrences: Occurrence[],
  opts: { enabled?: Record<Category, boolean>; now?: Date; limit?: number } = {},
): Occurrence[] {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 5;

  return occurrences
    .filter((occ) => {
      if (opts.enabled && !opts.enabled[occ.category]) return false;
      const start = new Date(occ.startsAt);
      return !Number.isNaN(start.getTime()) && start.getTime() > now.getTime();
    })
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    )
    .slice(0, limit);
}

/**
 * Notification copy. Shared so iOS, Android and the widget stay consistent.
 */
export function reminderContent(
  occ: Occurrence,
  fireAt: Date,
): { title: string; body: string } {
  const start = new Date(occ.startsAt);
  const mins = Math.max(0, Math.round((start.getTime() - fireAt.getTime()) / 60_000));

  const time = occ.endTime ? `${occ.startTime}–${occ.endTime}` : occ.startTime;
  const parts = [time];
  if (occ.venue) parts.push(occ.venue);

  return {
    title: mins <= 1 ? `${occ.title} — starting now` : `${occ.title} — in ${mins} min`,
    body: parts.join(' · '),
  };
}
