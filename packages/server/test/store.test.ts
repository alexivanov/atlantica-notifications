/**
 * Store housekeeping.
 *
 * This file replaces the server-side push dispatcher tests. Reminders are now
 * on-device local notifications and their selection logic lives in
 * @atlantica/shared, tested there without a device. What is left server-side is
 * keeping the state file from growing forever.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { DateTime } from 'luxon';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'atl-test-'));

const { RESORT_TZ } = await import('../src/config.js');
const store = await import('../src/store.js');
const { parseEntertainment } = await import('../src/scrape/entertainment.js');

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

test('pruning drops only what has already passed', async () => {
  await store.pruneOld(
    DateTime.fromISO('2026-07-28T00:00', { zone: RESORT_TZ }).toJSDate(),
  );
  const s = await store.load();
  const dates = new Set(Object.values(s.occurrences).map((o) => o.date));
  assert.ok(!dates.has('2026-07-27'), 'the 27th is gone');
  assert.ok(dates.has('2026-07-28'), 'later days survive');
});

test('pruning clears everything once the week is long past', async () => {
  await store.pruneOld(
    DateTime.fromISO('2026-08-12T12:00', { zone: RESORT_TZ }).toJSDate(),
  );
  const s = await store.load();
  assert.equal(Object.keys(s.occurrences).length, 0);
});
