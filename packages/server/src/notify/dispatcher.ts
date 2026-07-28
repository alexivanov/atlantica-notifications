import { DateTime } from 'luxon';
import { LEAD_MINUTES, RESORT_TZ } from '../config.js';
import * as store from '../store.js';
import type { Occurrence } from '../types.js';
import { sendTo } from './push.js';

/**
 * Fires reminders for anything starting within LEAD_MINUTES.
 *
 * Runs every minute. The tick has to be finer than the lead time -- driving a
 * 30-minute-ahead reminder off a 30-minute cron means it lands anywhere between
 * on-time and half an hour late.
 */
export async function dispatchDue(now?: DateTime): Promise<number> {
  const at = now ?? DateTime.now().setZone(RESORT_TZ);

  const state = await store.load();
  if (state.subscriptions.length === 0) return 0;

  const due = Object.values(state.occurrences).filter((occ) =>
    isDue(occ, at, state.sent),
  );
  if (due.length === 0) return 0;

  let sentCount = 0;

  for (const occ of due) {
    // Re-read each iteration: sendTo may have pruned a dead subscription.
    const current = await store.load();
    const targets = current.subscriptions.filter((s) => s.enabled[occ.category]);

    // If nobody wants this category, mark it handled so we stop re-evaluating
    // it every minute for the rest of its window.
    if (targets.length === 0) {
      await store.update((s) => {
        s.sent[occ.key] = new Date().toISOString();
      });
      continue;
    }

    const payload = buildPayload(occ);
    let anyDelivered = false;
    for (const sub of targets) {
      const alive = await sendTo(sub, payload);
      if (alive) anyDelivered = true;
    }

    // Only record it as sent if at least one live endpoint took it. Otherwise
    // leave it pending so a phone that re-subscribes still gets the reminder.
    if (anyDelivered) {
      await store.update((s) => {
        s.sent[occ.key] = new Date().toISOString();
      });
      sentCount++;
      console.log(`[dispatch] sent "${occ.title}" (${occ.date} ${occ.startTime})`);
    }
  }

  return sentCount;
}

export function isDue(
  occ: Occurrence,
  now: DateTime,
  sent: Record<string, string>,
): boolean {
  if (sent[occ.key]) return false;
  const start = DateTime.fromISO(occ.startsAt).setZone(RESORT_TZ);
  if (!start.isValid) return false;
  const windowOpens = start.minus({ minutes: LEAD_MINUTES });
  // Fire between "lead time before" and the start itself. Once it has started,
  // a reminder is just noise, so we let it lapse rather than sending late.
  return now >= windowOpens && now < start;
}

export function buildPayload(occ: Occurrence) {
  const start = DateTime.fromISO(occ.startsAt).setZone(RESORT_TZ);
  const mins = Math.max(0, Math.round(start.diffNow('minutes').minutes));

  const when = mins <= 1 ? 'starting now' : `in ${mins} min`;
  const bodyParts = [`${occ.startTime}${occ.endTime ? `-${occ.endTime}` : ''}`];
  if (occ.venue) bodyParts.push(occ.venue);

  return {
    title: `${occ.title} — ${when}`,
    body: bodyParts.join(' · '),
    tag: occ.key,
    url: '/',
  };
}

/**
 * On a cold start, mark everything already inside its reminder window as sent.
 *
 * Without this, deploying at 20:50 would immediately fire a burst of
 * notifications for every 21:00 show -- technically correct, extremely annoying.
 */
export async function suppressBackfill(now?: DateTime): Promise<number> {
  const at = now ?? DateTime.now().setZone(RESORT_TZ);
  return store.update((s) => {
    let n = 0;
    for (const occ of Object.values(s.occurrences)) {
      if (!s.sent[occ.key] && isDue(occ, at, s.sent)) {
        s.sent[occ.key] = new Date().toISOString();
        n++;
      }
    }
    s.initialised = true;
    return n;
  });
}

/**
 * Drop bookkeeping for occurrences that finished more than a few days ago, so
 * the state file does not grow without bound.
 */
export async function pruneOld(now?: DateTime): Promise<void> {
  const cutoff = (now ?? DateTime.now().setZone(RESORT_TZ)).minus({ days: 3 });
  await store.update((s) => {
    for (const [key, occ] of Object.entries(s.occurrences)) {
      const start = DateTime.fromISO(occ.startsAt);
      if (start.isValid && start < cutoff) {
        delete s.occurrences[key];
        delete s.sent[key];
      }
    }
  });
}
