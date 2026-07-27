/**
 * One-shot scrape for manual verification: hits the live site, prints what it
 * found, and exits. Does not touch the store or send anything.
 */
import { DateTime } from 'luxon';
import { RESORT_TZ } from '../config.js';
import { buildIcs } from '../ics.js';
import { expandWeeklySchedule, loadWeeklySchedule } from '../scrape/daytime.js';
import { fetchEntertainment } from '../scrape/entertainment.js';

const now = DateTime.now().setZone(RESORT_TZ);
console.log(`resort time: ${now.toFormat('cccc dd LLL yyyy HH:mm ZZZZ')}\n`);

const ent = await fetchEntertainment(now);
console.log(`ENTERTAINMENT (${ent.length})`);
let day = '';
for (const o of ent) {
  if (o.date !== day) {
    day = o.date;
    console.log(`  ${DateTime.fromISO(day).toFormat('ccc dd LLL')}`);
  }
  console.log(
    `    ${o.startTime}${o.endTime ? `-${o.endTime}` : '     '}  ` +
      `${o.title.padEnd(38)} ${o.venue ?? ''}`,
  );
}

const day2 = expandWeeklySchedule(await loadWeeklySchedule(), now);
console.log(`\nDAYTIME (${day2.length} over the next 7 days)`);
const todayOnly = day2.filter((o) => o.date === now.toISODate());
console.log(`  today (${todayOnly.length}):`);
for (const o of todayOnly) {
  console.log(`    ${o.startTime}  ${o.title.padEnd(24)} ${o.venue}`);
}

const all = [...ent, ...day2];
const keys = new Set(all.map((o) => o.key));
console.log(`\ntotal ${all.length} occurrences, ${keys.size} unique keys`);
if (keys.size !== all.length) {
  console.error('KEY COLLISION -- dedup would drop reminders');
  process.exit(1);
}

const ics = buildIcs(all);
console.log(`ics: ${(ics.match(/BEGIN:VEVENT/g) ?? []).length} events, ${ics.length} bytes`);
