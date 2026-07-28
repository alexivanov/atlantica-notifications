/**
 * Dispatcher bookkeeping against a real (temp-dir) store.
 *
 * Run with DATA_DIR pointed at a scratch directory -- see npm run test:dispatch.
 * These cover the paths that decide whether a reminder is sent twice, or never.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { DateTime } from 'luxon';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'atl-test-'));

const { RESORT_TZ } = await import('../src/config.js');
const store = await import('../src/store.js');
const { isDue, pruneOld, suppressBackfill } = await import(
  '../src/notify/dispatcher.js'
);
const { parseEntertainment } = await import('../src/scrape/entertainment.js');

const { readFileSync } = await import('node:fs');
const FIXTURE = readFileSync('test/fixtures/entertainment-2026-07-27.html', 'utf8');
const CAPTURED = DateTime.fromISO('2026-07-27T12:00', { zone: RESORT_TZ });

before(async () => {
  const occ = parseEntertainment(FIXTURE, CAPTURED);
  await store.update((s) => {
    for (const o of occ) s.occurrences[o.key] = o;
  });
});

test('store round-trips occurrences to disk', async () => {
  const s = await store.load();
  assert.equal(Object.keys(s.occurrences).length, 15);
});

test('first-run backfill suppression marks in-window events as already sent', async () => {
  // 20:45 on the 27th: both 21:00 shows are inside the 30-minute window.
  const at = DateTime.fromISO('2026-07-27T20:45', { zone: RESORT_TZ });

  const n = await suppressBackfill(at);
  assert.equal(n, 2, 'both 21:00 shows suppressed rather than fired on boot');

  const s = await store.load();
  assert.equal(s.initialised, true);

  // Nothing is due any more at that instant -- this is what stops a deploy at
  // 20:50 from firing a burst of notifications.
  const stillDue = Object.values(s.occurrences).filter((o) => isDue(o, at, s.sent));
  assert.equal(stillDue.length, 0);
});

test('a suppressed or sent occurrence never becomes due again', async () => {
  const s = await store.load();
  const at = DateTime.fromISO('2026-07-27T20:50', { zone: RESORT_TZ });
  // Five minutes later, still inside the window -- must stay silent.
  const due = Object.values(s.occurrences).filter((o) => isDue(o, at, s.sent));
  assert.equal(due.length, 0, 'no duplicate send on the next tick');
});

test('later days are still pending after the first-run suppression', async () => {
  const s = await store.load();
  // The 28th at 20:45. Suppression only ever applied to the 27th, so Tuesday
  // must still fire normally. Both shows qualify: 21:00 is 15 minutes out, and
  // 21:15 is exactly 30 minutes out (the window opens inclusively).
  const at = DateTime.fromISO('2026-07-28T20:45', { zone: RESORT_TZ });
  const due = Object.values(s.occurrences).filter((o) => isDue(o, at, s.sent));
  assert.deepEqual(due.map((o) => o.title).sort(), ['Martini Trio', 'The Drifters']);

  // Ten minutes earlier only the 21:00 show is inside its window.
  const earlier = DateTime.fromISO('2026-07-28T20:35', { zone: RESORT_TZ });
  const dueEarlier = Object.values(s.occurrences).filter((o) =>
    isDue(o, earlier, s.sent),
  );
  assert.deepEqual(dueEarlier.map((o) => o.title), ['Martini Trio']);
});

test('pruning drops long-past occurrences and their sent records', async () => {
  // Ten days after the fixture week, everything is stale.
  await pruneOld(DateTime.fromISO('2026-08-12T12:00', { zone: RESORT_TZ }));
  const s = await store.load();
  assert.equal(Object.keys(s.occurrences).length, 0);
  assert.equal(Object.keys(s.sent).length, 0);
});
