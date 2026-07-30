import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DateTime } from 'luxon';
import { RESORT_TZ } from '../src/config.js';
import { buildIcs } from '../src/ics.js';
import {
  DateResolutionError,
  parseTimeRange,
  resolveDayLabel,
} from '../src/scrape/dates.js';
import {
  expandWeeklySchedule,
  loadWeeklySchedule,
} from '../src/scrape/daytime.js';
import { parseEntertainment } from '../src/scrape/entertainment.js';

// Resolved from the project root so it works from dist/ too.
const FIXTURE = readFileSync(
  'test/fixtures/entertainment-2026-07-27.html',
  'utf8',
);

/** The day the fixture was captured. */
const CAPTURED = DateTime.fromISO('2026-07-27T12:00', { zone: RESORT_TZ });

/* -------------------------------------------------------------- *
 * Date resolution
 * -------------------------------------------------------------- */

test('resolves Today and Tomorrow against resort-local now', () => {
  assert.equal(resolveDayLabel('Today, 27.07.', CAPTURED).date, '2026-07-27');
  assert.equal(resolveDayLabel('Tomorrow, 28.07.', CAPTURED).date, '2026-07-28');
});

test('infers the year for a bare DD.MM. label', () => {
  const r = resolveDayLabel('Saturday, 01.08.', CAPTURED);
  assert.equal(r.date, '2026-08-01');
  assert.equal(r.weekdayVerified, true);
});

test('rolls the year over from December into January', () => {
  const nye = DateTime.fromISO('2026-12-29T12:00', { zone: RESORT_TZ });
  // 2 Jan 2027 is a Saturday; 2 Jan 2026 was a Friday. Getting the year wrong
  // here would put the reminder 364 days out.
  const r = resolveDayLabel('Saturday, 02.01.', nye);
  assert.equal(r.date, '2027-01-02');
});

test('throws when the weekday name contradicts the resolved date', () => {
  // 29.07.2026 is a Wednesday, so claiming Monday means something is wrong.
  assert.throws(
    () => resolveDayLabel('Monday, 29.07.', CAPTURED),
    DateResolutionError,
  );
});

test('parses time ranges, with and without an end time', () => {
  assert.deepEqual(parseTimeRange('21:00 - 23:30'), {
    start: '21:00',
    end: '23:30',
  });
  assert.deepEqual(parseTimeRange('21:15-22:30'), {
    start: '21:15',
    end: '22:30',
  });
  assert.deepEqual(parseTimeRange('9:00'), { start: '09:00', end: null });
  assert.equal(parseTimeRange('no times here'), null);
});

/* -------------------------------------------------------------- *
 * Entertainment scraper
 * -------------------------------------------------------------- */

test('parses every event from the live fixture', () => {
  const occ = parseEntertainment(FIXTURE, CAPTURED);
  assert.equal(occ.length, 15, 'fixture contains 15 events');
});

test('carries the sticky day header across cards in the same day group', () => {
  // The `.day` div is only rendered on the FIRST card of each day. If it is not
  // carried forward, the second event of each day is misdated (or dropped).
  const occ = parseEntertainment(FIXTURE, CAPTURED);
  const today = occ.filter((o) => o.date === '2026-07-27');
  assert.equal(today.length, 2, 'both 27.07 events are dated correctly');
  assert.deepEqual(
    today.map((o) => o.title).sort(),
    ['DJ Set', 'DJ Set | Live Saxophone | Fire Show'],
  );

  // Wednesday has three cards, only the first of which carries a day heading.
  assert.equal(occ.filter((o) => o.date === '2026-07-29').length, 3);
});

test('gives repeated event ids distinct per-occurrence keys', () => {
  // The site reuses id=3243 ("DJ Set", Sky Bar) on 27.07, 30.07 and 02.08.
  // Keying dedup on the event id alone would send one reminder and silently
  // swallow the other two.
  const occ = parseEntertainment(FIXTURE, CAPTURED);
  const djSets = occ.filter((o) => o.sourceId === '3243');
  assert.equal(djSets.length, 3, 'id 3243 appears three times');

  const keys = new Set(djSets.map((o) => o.key));
  assert.equal(keys.size, 3, 'each showing gets its own key');

  assert.deepEqual(djSets.map((o) => o.date).sort(), [
    '2026-07-27',
    '2026-07-30',
    '2026-08-02',
  ]);
});

test('every occurrence key in the fixture is unique', () => {
  const occ = parseEntertainment(FIXTURE, CAPTURED);
  assert.equal(new Set(occ.map((o) => o.key)).size, occ.length);
});

test('extracts venue and description separately', () => {
  const occ = parseEntertainment(FIXTURE, CAPTURED);
  const loggos = occ.find((o) => o.title === 'Loggos Duo');
  assert.ok(loggos);
  assert.equal(loggos.venue, 'Sky Bar');
  assert.match(loggos.description ?? '', /saxophone/i);

  const drifters = occ.find((o) => o.title === 'The Drifters');
  assert.equal(drifters?.venue, 'Helios Pool Bar');
  assert.equal(drifters?.description, null);
});

test('start instants are anchored to resort time, not the host timezone', () => {
  const occ = parseEntertainment(FIXTURE, CAPTURED);
  const first = occ.find((o) => o.date === '2026-07-27' && o.startTime === '21:00');
  assert.ok(first);
  // Late July in Greece is EEST, UTC+3.
  assert.match(first.startsAt, /^2026-07-27T21:00:00\.000\+03:00$/);
});

test('throws rather than reporting an empty schedule when markup changes', () => {
  assert.throws(() => parseEntertainment('<html><body>nothing</body></html>'));
});

/* -------------------------------------------------------------- *
 * Daytime schedule
 * -------------------------------------------------------------- */

test('expands the weekly grid into dated occurrences', async () => {
  const schedule = await loadWeeklySchedule();
  const occ = expandWeeklySchedule(schedule, CAPTURED);

  // 27 July 2026 is a Monday, so the 7-day horizon is Mon..Sun = one full week.
  const total = Object.values(schedule.week).reduce((n, d) => n + d.length, 0);
  assert.equal(occ.length, total);

  const monday = occ.filter((o) => o.date === '2026-07-27');
  assert.equal(monday.length, 8);
  assert.equal(monday[0].title, 'Beach Yoga');
  assert.equal(monday[0].venue, 'Beach Lawn');
  assert.equal(monday[0].startTime, '09:00');

  // Wednesday is a light day in the printed programme.
  assert.equal(occ.filter((o) => o.date === '2026-07-29').length, 4);
});

test('daytime occurrence keys are unique across the horizon', async () => {
  const occ = expandWeeklySchedule(await loadWeeklySchedule(), CAPTURED);
  assert.equal(new Set(occ.map((o) => o.key)).size, occ.length);
});

/* -------------------------------------------------------------- *
 * ICS
 * -------------------------------------------------------------- */

test('builds a valid calendar with a 30-minute alarm per event', () => {
  const occ = parseEntertainment(FIXTURE, CAPTURED);
  const ics = buildIcs(occ);

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 15);
  assert.equal((ics.match(/TRIGGER:-PT30M/g) ?? []).length, 15);

  // 21:00 EEST == 18:00 UTC.
  assert.match(ics, /DTSTART:20260727T180000Z/);
  // UIDs must be per-occurrence, so the three DJ Sets don't collapse into one.
  const uids = [...ics.matchAll(/UID:(.+)/g)].map((m) => m[1]);
  assert.equal(new Set(uids).size, 15);
});

test('an event running past midnight gets an end after its start', () => {
  const ics = buildIcs([
    {
      key: 'entertainment|2026-07-27|23:30|x',
      category: 'entertainment',
      sourceId: 'x',
      title: 'Late Show',
      date: '2026-07-27',
      startTime: '23:30',
      endTime: '00:30',
      venue: 'Sky Bar',
      description: null,
      startsAt: '2026-07-27T23:30:00.000+03:00',
      url: null,
    },
  ]);
  assert.match(ics, /DTSTART:20260727T203000Z/);
  assert.match(ics, /DTEND:20260727T213000Z/);
});

test('filters by category', async () => {
  const occ = [
    ...parseEntertainment(FIXTURE, CAPTURED),
    ...expandWeeklySchedule(await loadWeeklySchedule(), CAPTURED),
  ];
  const onlyEnt = buildIcs(occ, { categories: ['entertainment'] });
  assert.equal((onlyEnt.match(/BEGIN:VEVENT/g) ?? []).length, 15);
  assert.equal((onlyEnt.match(/CATEGORIES:DAYTIME/g) ?? []).length, 0);
});
