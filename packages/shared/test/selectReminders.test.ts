import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IOS_PENDING_LIMIT,
  MAX_SCHEDULED,
  occurrenceKey,
  reminderContent,
  selectReminders,
  selectUpcoming,
  type Category,
  type Occurrence,
} from '../src/index.js';

const ALL: Record<Category, boolean> = { entertainment: true, daytime: true };

/** Build an occurrence at a given resort-local instant (+03:00 in summer). */
function occ(
  startsAt: string,
  over: Partial<Occurrence> = {},
): Occurrence {
  const [date, rest] = startsAt.split('T');
  const startTime = rest.slice(0, 5);
  const category = over.category ?? 'entertainment';
  const sourceId = over.sourceId ?? 'x';
  return {
    key: occurrenceKey(category, date, startTime, sourceId),
    category,
    sourceId,
    title: 'DJ Set',
    date,
    startTime,
    endTime: null,
    venue: 'Sky Bar',
    description: null,
    startsAt,
    url: null,
    ...over,
  };
}

const NOW = new Date('2026-07-28T12:00:00+03:00');

test('fires at exactly lead-time before the start', () => {
  const plan = selectReminders([occ('2026-07-28T21:00:00.000+03:00')], {
    leadMinutes: 30,
    enabled: ALL,
    now: NOW,
  });
  assert.equal(plan.entries.length, 1);
  assert.equal(
    plan.entries[0].fireAt.toISOString(),
    new Date('2026-07-28T20:30:00+03:00').toISOString(),
  );
});

test('drops events that have already started', () => {
  const plan = selectReminders(
    [
      occ('2026-07-28T09:00:00.000+03:00'), // this morning
      occ('2026-07-28T21:00:00.000+03:00'),
    ],
    { leadMinutes: 30, enabled: ALL, now: NOW },
  );
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].occurrence.startTime, '21:00');
});

test('skips events already inside the lead window rather than firing instantly', () => {
  // Starts in 10 minutes, lead is 30 -- the fire time is in the past. Arming it
  // would deliver immediately, and on a batch re-arm that means a burst.
  const plan = selectReminders([occ('2026-07-28T12:10:00.000+03:00')], {
    leadMinutes: 30,
    enabled: ALL,
    now: NOW,
  });
  assert.equal(plan.entries.length, 0);
});

test('honours per-category mute switches', () => {
  const list = [
    occ('2026-07-28T21:00:00.000+03:00', { category: 'entertainment' }),
    occ('2026-07-28T17:30:00.000+03:00', { category: 'daytime', sourceId: 'y' }),
  ];

  const entOnly = selectReminders(list, {
    leadMinutes: 30,
    enabled: { entertainment: true, daytime: false },
    now: NOW,
  });
  assert.deepEqual(entOnly.entries.map((e) => e.occurrence.category), [
    'entertainment',
  ]);

  const dayOnly = selectReminders(list, {
    leadMinutes: 30,
    enabled: { entertainment: false, daytime: true },
    now: NOW,
  });
  assert.deepEqual(dayOnly.entries.map((e) => e.occurrence.category), ['daytime']);

  const none = selectReminders(list, {
    leadMinutes: 30,
    enabled: { entertainment: false, daytime: false },
    now: NOW,
  });
  assert.equal(none.entries.length, 0);
});

test('caps the schedule below the iOS pending limit and keeps the soonest', () => {
  // A full week is ~63 occurrences, which straddles the iOS cap of 64.
  // Start the week *tomorrow* so every generated event is genuinely in the
  // future and the cap -- not the past-filter -- is what is under test.
  const list: Occurrence[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 9; h++) {
      // Roll the date via UTC arithmetic: naive `28 + d` produces
      // "2026-07-32" (an Invalid Date, silently filtered), while anchoring a
      // +03:00 midnight would land on the previous UTC day and shift the whole
      // week back by one.
      const iso = new Date(Date.UTC(2026, 6, 29 + d)).toISOString().slice(0, 10);
      const hour = String(9 + h).padStart(2, '0');
      list.push(
        occ(`${iso}T${hour}:00:00.000+03:00`, { sourceId: `${d}-${h}` }),
      );
    }
  }
  assert.equal(list.length, 63, 'fixture reproduces a realistic week');
  assert.ok(
    list.every((o) => !Number.isNaN(new Date(o.startsAt).getTime())),
    'every generated date is valid',
  );

  const plan = selectReminders(list, {
    leadMinutes: 30,
    enabled: ALL,
    now: NOW,
  });

  assert.equal(plan.entries.length, MAX_SCHEDULED);
  assert.ok(
    plan.entries.length < IOS_PENDING_LIMIT,
    'stays under the limit iOS silently enforces',
  );
  assert.ok(plan.droppedForCapacity > 0, 'reports what did not fit');
  assert.equal(
    plan.entries.length + plan.droppedForCapacity,
    63,
    'every event is either armed or explicitly counted as dropped',
  );

  // The kept ones must be the SOONEST, not an arbitrary slice -- that is the
  // whole point of the cap.
  const times = plan.entries.map((e) => e.fireAt.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'sorted ascending');
  const keptMax = Math.max(...times);
  assert.ok(plan.coversUntil);
  assert.equal(plan.coversUntil.getTime(), keptMax);
});

test('reports coverage honestly when everything fits', () => {
  const plan = selectReminders(
    [
      occ('2026-07-28T21:00:00.000+03:00'),
      occ('2026-07-29T21:00:00.000+03:00', { sourceId: 'b' }),
    ],
    { leadMinutes: 30, enabled: ALL, now: NOW },
  );
  assert.equal(plan.droppedForCapacity, 0);
  assert.equal(
    plan.coversUntil?.toISOString(),
    new Date('2026-07-29T20:30:00+03:00').toISOString(),
  );
});

test('an empty plan reports null coverage rather than a bogus date', () => {
  const plan = selectReminders([], { leadMinutes: 30, enabled: ALL, now: NOW });
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.coversUntil, null);
  assert.equal(plan.droppedForCapacity, 0);
});

test('fire times are absolute, so a device outside resort time still fires correctly', () => {
  // The same 21:00 resort-time show, viewed from a phone set to London.
  // 21:00+03:00 == 18:00 UTC == 19:00 BST. The alarm must be pinned to the
  // instant, not re-derived from the "21:00" wall-clock string.
  const plan = selectReminders([occ('2026-07-28T21:00:00.000+03:00')], {
    leadMinutes: 30,
    enabled: ALL,
    now: NOW,
  });
  assert.equal(plan.entries[0].fireAt.toISOString(), '2026-07-28T17:30:00.000Z');
});

test('ignores occurrences with an unparseable start instant', () => {
  const plan = selectReminders(
    [
      occ('2026-07-28T21:00:00.000+03:00'),
      { ...occ('2026-07-28T22:00:00.000+03:00'), startsAt: 'not-a-date' },
    ],
    { leadMinutes: 30, enabled: ALL, now: NOW },
  );
  assert.equal(plan.entries.length, 1);
});

test('ids are per-occurrence, so a repeated event id gets its own alarm', () => {
  // id=3243 legitimately appears on three different days.
  const plan = selectReminders(
    [
      occ('2026-07-28T21:00:00.000+03:00', { sourceId: '3243' }),
      occ('2026-07-30T21:00:00.000+03:00', { sourceId: '3243' }),
      occ('2026-08-02T21:00:00.000+03:00', { sourceId: '3243' }),
    ],
    { leadMinutes: 30, enabled: ALL, now: NOW },
  );
  assert.equal(plan.entries.length, 3);
  assert.equal(new Set(plan.entries.map((e) => e.id)).size, 3);
});

test('selectUpcoming ignores lead time and returns the next few', () => {
  const list = [
    occ('2026-07-28T12:05:00.000+03:00', { sourceId: 'soon' }), // 5 min away
    occ('2026-07-28T21:00:00.000+03:00', { sourceId: 'later' }),
    occ('2026-07-28T09:00:00.000+03:00', { sourceId: 'past' }),
  ];
  const next = selectUpcoming(list, { now: NOW, limit: 5 });
  assert.deepEqual(next.map((o) => o.sourceId), ['soon', 'later']);
});

test('reminder copy states the real gap and includes the venue', () => {
  const o = occ('2026-07-28T21:00:00.000+03:00', {
    title: 'Greek Night',
    venue: 'Helios Pool Bar',
    endTime: '23:15',
  });
  const c = reminderContent(o, new Date('2026-07-28T20:30:00+03:00'));
  assert.equal(c.title, 'Greek Night — in 30 min');
  assert.equal(c.body, '21:00–23:15 · Helios Pool Bar');
});
