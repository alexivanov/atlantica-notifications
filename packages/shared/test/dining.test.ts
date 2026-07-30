import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  discountedPrice,
  isOpenAt,
  rateFor,
  timeOf,
  weekdayOf,
  type ServicePeriod,
  type Venue,
  type VenueMenu,
} from '../src/dining.js';

const venues = JSON.parse(readFileSync('data/venues.json', 'utf8')) as {
  venues: Venue[];
  themeNights: Record<string, string>;
  specialEvents: unknown[];
};
const menus = JSON.parse(readFileSync('data/menus.json', 'utf8')) as Record<
  string,
  VenueMenu
>;

const bySlug = (s: string): Venue => {
  const v = venues.venues.find((x) => x.slug === s);
  assert.ok(v, `no venue ${s}`);
  return v;
};

/* ---------------------------------------------------------------- *
 * Open / closed -- the cases that actually break it
 * ---------------------------------------------------------------- */

test('a bar closing at midnight is open late in the evening', () => {
  // "00:00" is 0 minutes, i.e. numerically *before* the 10:00 opening. Treat it
  // naively and every bar reads as closed all day.
  const sky = bySlug('skybar');
  assert.equal(isOpenAt(sky, 'tuesday', '23:30').open, true);
  assert.equal(isOpenAt(sky, 'tuesday', '12:00').open, true);
});

test('closing at 00:00 means closing AT midnight, not after it', () => {
  // "10:00 - 00:00" is open until midnight, so the small hours are closed.
  // Worth pinning down: it is easy to conflate "ends at 00:00" with "runs past
  // midnight", and they behave differently.
  const sky = bySlug('skybar');
  assert.equal(isOpenAt(sky, 'tuesday', '23:59').open, true);
  assert.equal(isOpenAt(sky, 'wednesday', '00:30').open, false);
  assert.equal(isOpenAt(sky, 'wednesday', '09:00').open, false);
});

test('a period that genuinely runs past midnight covers the small hours', () => {
  // Nothing at the resort currently opens past midnight, but the logic has to
  // hold if one ever does -- otherwise it fails the night it starts.
  const lateBar = { periods: [{ from: '20:00', to: '02:00' }] };
  assert.equal(isOpenAt(lateBar, 'friday', '23:00').open, true);
  assert.equal(isOpenAt(lateBar, 'saturday', '01:00').open, true, 'still Friday night');
  assert.equal(isOpenAt(lateBar, 'saturday', '03:00').open, false);
  assert.equal(isOpenAt(lateBar, 'saturday', '19:00').open, false);
});

test('Helios honours its Saturday exception in both directions', () => {
  const helios = bySlug('helios');
  // Normally open until midnight...
  assert.equal(isOpenAt(helios, 'friday', '19:00').open, true);
  // ...but Saturdays it shuts at 18:00.
  assert.equal(isOpenAt(helios, 'saturday', '19:00').open, false);
  assert.equal(isOpenAt(helios, 'saturday', '17:00').open, true);
  // And it is back to normal on Sunday.
  assert.equal(isOpenAt(helios, 'sunday', '19:00').open, true);
});

test('the Saturday-only period does not leak into other days', () => {
  // Saturday's 10:00-18:00 entry must not make Sunday close at 18:00.
  const helios = bySlug('helios');
  const state = isOpenAt(helios, 'sunday', '23:00');
  assert.equal(state.open, true);
});

test('Saturday night does not spill into Sunday morning', () => {
  // Saturday ends at 18:00, so 00:30 Sunday must be closed -- this is the case
  // a naive "previous day crossed midnight" check gets wrong.
  const helios = bySlug('helios');
  assert.equal(isOpenAt(helios, 'sunday', '00:30').open, false);
});

test('meal periods open and close as published', () => {
  const agora = bySlug('agora');
  assert.equal(isOpenAt(agora, 'monday', '08:00').open, true);
  assert.equal(isOpenAt(agora, 'monday', '11:00').open, false);
  assert.equal(isOpenAt(agora, 'monday', '13:00').open, true);
  assert.equal(isOpenAt(agora, 'monday', '19:00').open, true);
  assert.equal(isOpenAt(agora, 'monday', '22:00').open, false);
});

test('closed venues report when they next open', () => {
  const agora = bySlug('agora');
  const state = isOpenAt(agora, 'monday', '11:00');
  assert.equal(state.open, false);
  assert.equal(state.next?.label, 'Lunch');
  assert.equal(state.next?.from, '12:30');
});

test('a venue with no published hours is never reported open', () => {
  // Ginger and friends are evening-only by reservation and publish nothing.
  const ginger = bySlug('ginger');
  assert.equal(ginger.periods.length, 0);
  assert.equal(isOpenAt(ginger, 'friday', '20:00').open, false);
  assert.ok(ginger.hoursNote, 'explains why there are no hours');
});

test('the exact boundary opens and closes correctly', () => {
  const period: ServicePeriod[] = [{ from: '12:00', to: '14:00' }];
  const v = { periods: period };
  assert.equal(isOpenAt(v, 'monday', '11:59').open, false);
  assert.equal(isOpenAt(v, 'monday', '12:00').open, true, 'inclusive at open');
  assert.equal(isOpenAt(v, 'monday', '13:59').open, true);
  assert.equal(isOpenAt(v, 'monday', '14:00').open, false, 'exclusive at close');
});

/* ---------------------------------------------------------------- *
 * Timezone -- the phone is not necessarily on resort time
 * ---------------------------------------------------------------- */

test('weekday and time are read in the resort timezone, not the host', () => {
  // 22:30 UTC on a Monday is already Tuesday 01:30 in Athens.
  const instant = new Date('2026-07-27T22:30:00Z');
  assert.equal(weekdayOf(instant, 'Europe/Athens'), 'tuesday');
  assert.equal(timeOf(instant, 'Europe/Athens'), '01:30');
  assert.equal(weekdayOf(instant, 'UTC'), 'monday');
});

/* ---------------------------------------------------------------- *
 * All-inclusive pricing -- rates differ per venue AND per category
 * ---------------------------------------------------------------- */

test('discountedPrice rounds to cents', () => {
  assert.equal(discountedPrice(9.5, 0.5), 4.75);
  assert.equal(discountedPrice(9, 0.3), 6.3);
  assert.equal(discountedPrice(27, 0.3), 18.9);
  // 10.5 * 0.5 is exact, but 8.4 style values expose float drift.
  assert.equal(discountedPrice(10.5, 0.5), 5.25);
});

test('each venue carries the rate its own legend states', () => {
  // Reading Agora's 50% as universal would overstate the discount at every
  // a la carte restaurant.
  assert.equal(menus.agora.aiRate, 0.5);
  assert.equal(menus.helios.aiRate, 0.5);
  assert.equal(menus.ginger.aiRate, 0.3);
  assert.equal(menus.mylos.aiRate, 0.3);
  assert.equal(menus.bluebay.aiRate, 0.3);
  assert.equal(menus.streetfood.aiRate, 0.3);
});

test('The Cove applies 30% to food and 50% to drink', () => {
  const cove = menus.cove;
  assert.equal(rateFor(cove, 'Snacks'), 0.3);
  assert.equal(rateFor(cove, 'Sushi'), 0.3);
  assert.equal(rateFor(cove, 'Gin'), 0.5);
  assert.equal(rateFor(cove, 'Famous Cocktails'), 0.5);
});

test('every captured finalPrice matches its category rate', () => {
  let checked = 0;
  for (const menu of Object.values(menus)) {
    for (const cat of menu.categories) {
      const rate = rateFor(menu, cat.name);
      for (const item of cat.items) {
        if (item.allInclusive !== 'discounted' || item.price === undefined) continue;
        assert.equal(
          item.finalPrice,
          discountedPrice(item.price, rate),
          `${menu.name} / ${cat.name} / ${item.name}`,
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `expected many discounted items, checked ${checked}`);
});

/* ---------------------------------------------------------------- *
 * Captured data integrity
 * ---------------------------------------------------------------- */

test('captured menus are complete and free of marker residue', () => {
  const slugs = Object.keys(menus);
  assert.equal(slugs.length, 10);

  let items = 0;
  for (const [slug, menu] of Object.entries(menus)) {
    const n = menu.categories.reduce((s, c) => s + c.items.length, 0);
    assert.ok(n > 0, `${slug} captured zero items`);
    items += n;

    for (const cat of menu.categories) {
      assert.ok(cat.name, `${slug} has an unnamed category`);
      for (const item of cat.items) {
        // "(A/I)" / "(A/I)*" / the "(A/l)" typo must all have been stripped.
        assert.ok(
          !/\(\s*A\s*\/\s*[Il]/i.test(item.name),
          `marker left in ${slug}: ${item.name}`,
        );
      }
    }
  }
  assert.ok(items > 600, `expected ~700 items, got ${items}`);
});

test('every venue with a menuKey resolves to a captured menu', () => {
  for (const v of venues.venues) {
    if (!v.menuKey) continue;
    assert.ok(menus[v.menuKey], `${v.slug} points at missing menu ${v.menuKey}`);
  }
});

test('theme nights cover all seven days', () => {
  for (const d of [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ]) {
    assert.ok(venues.themeNights[d], `no theme for ${d}`);
  }
});
