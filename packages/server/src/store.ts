import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';
import { emptyStore, type StoreShape } from './types.js';

/**
 * Tiny JSON-file store. Deliberately not a database: this holds ~50 occurrences
 * and 2 push subscriptions for a one-week trip, and avoiding a native module
 * (better-sqlite3) keeps the container build trivial.
 *
 * Writes go through a temp file + rename so a crash mid-write cannot leave a
 * truncated state file behind -- losing the `sent` map would re-send every
 * pending reminder.
 */

const FILE = join(DATA_DIR, 'state.json');

let cache: StoreShape | null = null;
/** Serialises concurrent writes; the cron tick and HTTP handlers both write. */
let writeChain: Promise<void> = Promise.resolve();

export async function load(): Promise<StoreShape> {
  if (cache) return cache;

  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });

  if (existsSync(FILE)) {
    try {
      const parsed = JSON.parse(await readFile(FILE, 'utf8')) as StoreShape;
      cache = { ...emptyStore(), ...parsed };
      return cache;
    } catch (err) {
      console.error(
        '[store] state.json unreadable, starting fresh:',
        (err as Error).message,
      );
    }
  }

  cache = emptyStore();
  return cache;
}

/** Read-modify-write under a promise chain so updates cannot interleave. */
export async function update<T>(fn: (s: StoreShape) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const store = await load();
    const result = await fn(store);
    await persist(store);
    return result;
  });
  // Keep the chain alive even if this update throws.
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function persist(store: StoreShape): Promise<void> {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await rename(tmp, FILE);
  cache = store;
}

/**
 * Drop occurrences that finished more than a few days ago, so the state file
 * does not grow without bound.
 *
 * Lived in the notification dispatcher until the PWA and its push stack were
 * removed; it is store housekeeping, not a notification concern, so it moved
 * here rather than being deleted with the rest.
 */
export async function pruneOld(before: Date): Promise<void> {
  await update((s) => {
    for (const [key, occ] of Object.entries(s.occurrences)) {
      const start = new Date(occ.startsAt);
      if (!Number.isNaN(start.getTime()) && start < before) {
        delete s.occurrences[key];
      }
    }
  });
}

/**
 * Synchronous read of the already-loaded state, or null before the first load.
 *
 * Used only by the bearer-token lookup, which sits in a Fastify preHandler and
 * must be synchronous. Safe because the server loads the store during boot,
 * long before it accepts a request.
 */
export function peek(): StoreShape | null {
  return cache;
}

/** Test hook. */
export function _reset(): void {
  cache = null;
  writeChain = Promise.resolve();
}
