/**
 * One-off capture of the resort's e-menus into committed static JSON.
 *
 * Deliberately NOT a runtime scraper. The app ships the captured file, so there
 * is nothing to rate-limit, nothing to break silently when the site changes,
 * and no network dependency for browsing a menu. Re-run by hand when the resort
 * changes its menus (seasonally, in practice).
 *
 *     npx tsx scripts/capture-menus.ts
 *
 * All-inclusive marking is a suffix on the item name -- "(A/I)" for included,
 * "(A/I*)" for discounted -- but the discount RATE lives in each menu's own
 * legend and differs per venue, and for The Cove per category. Rates are
 * therefore declared below rather than inferred, and the discounted price is
 * resolved here so the app never does the arithmetic against a rate it might
 * have wrong.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface VenueSource {
  slug: string;
  name: string;
  project: number;
  /** Fraction off for "(A/I*)" items, e.g. 0.5 = 50% off. */
  aiRate: number;
  /** Overrides where the rate depends on the category (The Cove: food vs drink). */
  aiRateByCategory?: Record<string, number>;
  /** Bill-level discount that is not per item, shown as a note instead. */
  note?: string;
}

/**
 * Rates transcribed from each menu's own legend. Verified individually --
 * Agora's 50% is NOT universal, which is the trap here.
 */
const VENUES: VenueSource[] = [
  { slug: 'agora', name: 'Agora Restaurant', project: 555, aiRate: 0.5 },
  {
    slug: 'ginger',
    name: 'Ginger, Fusion Cuisine',
    project: 556,
    aiRate: 0.3,
    note: 'Half board guests receive €12.00 per person off the total bill.',
  },
  {
    slug: 'mylos',
    name: 'Mylos, Modern Greek Cuisine',
    project: 557,
    aiRate: 0.3,
    note: 'Half board guests receive €12.00 per person off the total bill.',
  },
  {
    slug: 'bluebay',
    name: 'Blue Bay, Fine Dining Restaurant',
    project: 558,
    aiRate: 0.3,
    note: 'Half board guests receive €12.00 per person off the total bill.',
  },
  { slug: 'streetfood', name: 'Street Food Lab', project: 560, aiRate: 0.3 },
  { slug: 'inroom', name: 'In Room Services', project: 561, aiRate: 0 },
  { slug: 'lounge', name: 'The Lounge Bar', project: 562, aiRate: 0.5 },
  { slug: 'skybar', name: 'Sky Bar', project: 635, aiRate: 0.5 },
  { slug: 'helios', name: 'Helios Pool Bar', project: 636, aiRate: 0.5 },
  {
    slug: 'cove',
    name: 'The Cove Beach Bar',
    project: 853,
    // "50% reduction of beverages & 30% reduction of food" -- the only venue
    // where one rate does not cover the whole menu.
    aiRate: 0.5,
    aiRateByCategory: { Snacks: 0.3, Sushi: 0.3 },
  },
];

const BASE = 'https://kioskcms.biz/template/emenu/project';

export type AllInclusive = 'included' | 'discounted' | 'none';

export interface CapturedItem {
  name: string;
  allInclusive: AllInclusive;
  /** Menu price in euros. Absent when the menu publishes none. */
  price?: number;
  /** What an all-inclusive guest actually pays, when discounted. */
  finalPrice?: number;
  description?: string;
}

export interface CapturedCategory {
  name: string;
  items: CapturedItem[];
}

export interface CapturedVenue {
  name: string;
  project: number;
  aiRate: number;
  aiRateByCategory?: Record<string, number>;
  note?: string;
  legend?: string;
  categories: CapturedCategory[];
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'atlantica-notifications/1.0 (menu capture)' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function decode(s: string): string {
  return s
    .replace(/&euro;/g, '€')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

function stripTags(s: string): string {
  return decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** "€ 19.00" -> 19. Returns undefined when no price is published. */
function parsePrice(raw: string): number | undefined {
  const m = raw.replace(',', '.').match(/(\d+(?:\.\d{1,2})?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** Round to cents, avoiding 3.4999999 from floating point. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Two traps here, both found by checking rather than trusting the legend.
 *
 * 1. Every legend describes the discounted marker as "A/I*", but the items
 *    actually write it as "(A/I)*" -- asterisk OUTSIDE the bracket. Matching
 *    only the inner form silently classified every discounted item as fully
 *    included, which is the worst possible way to be wrong about a price.
 * 2. The source contains "(A/l)" with a lowercase L instead of a capital I,
 *    a typo on the resort's side that appears across several menus.
 *
 * So: tolerate the asterisk on either side, and either letter.
 */
const AI_MARKER = /\(\s*A\s*\/\s*[Il]\s*(\*?)\s*\)\s*(\*?)/i;

function classify(rawName: string): { name: string; allInclusive: AllInclusive } {
  const m = rawName.match(AI_MARKER);
  if (!m) return { name: rawName.trim(), allInclusive: 'none' };

  const starred = Boolean(m[1] || m[2]);
  const name = rawName.replace(AI_MARKER, '').replace(/\s+/g, ' ').trim();

  return { name, allInclusive: starred ? 'discounted' : 'included' };
}

async function captureVenue(v: VenueSource): Promise<CapturedVenue> {
  const index = await get(`${BASE}/${v.project}`);

  const legendLine = stripTags(index)
    .split('|')
    .join(' | ')
    .match(/A\/I[^|]*\|[^|]*A\/I\*[^|]*/i)?.[0]
    ?.trim();

  // Category id -> name, taken from the index nav where the two sit together:
  //   <a href=".../category/6367"><div class="content-right">White Wines</div></a>
  // The category page itself does not carry its own title, so reading it there
  // yielded empty names -- which also silently disabled The Cove's
  // per-category discount override, since nothing matched "Snacks".
  const catNames = new Map<string, string>();
  for (const m of index.matchAll(
    new RegExp(
      `/project/${v.project}/category/(\\d+)"[^>]*>\\s*<div class="content-right">([\\s\\S]*?)</div>`,
      'g',
    ),
  )) {
    catNames.set(m[1], stripTags(m[2]));
  }

  // Category links, in the order the menu presents them.
  const catIds = [
    ...new Set(
      [...index.matchAll(new RegExp(`/project/${v.project}/category/(\\d+)`, 'g'))].map(
        (m) => m[1],
      ),
    ),
  ];

  const categories: CapturedCategory[] = [];
  const skipped: string[] = [];

  for (const cid of catIds) {
    // Some categories 500 on the resort's side. Skip them loudly rather than
    // abandoning the whole venue -- one broken page should not cost us a menu.
    let page: string;
    try {
      page = await get(`${BASE}/${v.project}/category/${cid}`);
    } catch (err) {
      try {
        // One retry, in case it is transient.
        page = await get(`${BASE}/${v.project}/category/${cid}`);
      } catch {
        skipped.push(`${cid} (${(err as Error).message})`);
        continue;
      }
    }

    const catName = catNames.get(cid) ?? `Category ${cid}`;

    const items: CapturedItem[] = [];

    for (const block of page.matchAll(
      /<div class="item">([\s\S]*?)<\/li>/g,
    )) {
      const html = block[1];
      const h2 = html.match(/<h2>([\s\S]*?)<\/h2>/);
      if (!h2) continue;

      const { name, allInclusive } = classify(stripTags(h2[1]));
      if (!name) continue;

      const priceRaw = html.match(/<span>([\s\S]*?)<\/span>/);
      const price = priceRaw ? parsePrice(stripTags(priceRaw[1])) : undefined;

      // Description paragraphs sit after the title block.
      const afterTitle = html.split('</div>').slice(1).join('</div>');
      const description = stripTags(afterTitle) || undefined;

      const rate = v.aiRateByCategory?.[catName] ?? v.aiRate;

      const item: CapturedItem = { name, allInclusive };
      if (price !== undefined) item.price = price;
      if (allInclusive === 'discounted' && price !== undefined && rate > 0) {
        item.finalPrice = money(price * (1 - rate));
      }
      if (description) item.description = description;

      items.push(item);
    }

    if (items.length) categories.push({ name: catName, items });
  }

  if (skipped.length) {
    console.log(`\n  skipped ${skipped.length} unreachable categor${skipped.length === 1 ? 'y' : 'ies'}: ${skipped.join(', ')}`);
  }

  return {
    name: v.name,
    project: v.project,
    aiRate: v.aiRate,
    ...(v.aiRateByCategory ? { aiRateByCategory: v.aiRateByCategory } : {}),
    ...(v.note ? { note: v.note } : {}),
    ...(legendLine ? { legend: legendLine } : {}),
    categories,
  };
}

async function main() {
  const out: Record<string, CapturedVenue> = {};
  let totalItems = 0;
  let totalCats = 0;

  for (const v of VENUES) {
    process.stdout.write(`${v.name.padEnd(34)} `);
    const captured = await captureVenue(v);
    const n = captured.categories.reduce((s, c) => s + c.items.length, 0);
    totalCats += captured.categories.length;
    totalItems += n;
    out[v.slug] = captured;
    console.log(`${String(captured.categories.length).padStart(2)} categories, ${String(n).padStart(3)} items`);

    // A venue that captured empty is the failure that would otherwise ship
    // silently, so shout about it rather than writing a hollow file.
    if (n === 0 && v.aiRate !== 0) {
      console.warn(`  !! ${v.name} captured ZERO items -- check the markup`);
    }
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const target = join(here, '..', 'data', 'menus.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(out, null, 1));

  console.log(`\n${Object.keys(out).length} venues, ${totalCats} categories, ${totalItems} items`);
  console.log(`written to ${target}`);
}

main().catch((err) => {
  console.error('Capture failed:', (err as Error).message);
  process.exit(1);
});
