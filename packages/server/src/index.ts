import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { DateTime } from 'luxon';
import cron from 'node-cron';
import {
  CATEGORIES,
  CRON,
  DEV_ALLOW_ORIGIN,
  HOST,
  ICS_TOKEN,
  LEAD_MINUTES,
  PORT,
  RESORT_TZ,
  type Category,
} from './config.js';
import {
  clerkOwnerId,
  isConfigured as clerkConfigured,
  requireClerkSession,
} from './clerkAuth.js';
import { buildIcs } from './ics.js';
import { runScrape } from './scrape/index.js';
import * as store from './store.js';

/**
 * Serves the normalised resort schedule to the native app, plus an ICS feed.
 *
 * Reminders are scheduled on-device as local notifications, so this server is
 * not in the notification path at all -- it only says *what* is on. That is why
 * there is no push stack here any more.
 */
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

/**
 * Development-only CORS.
 *
 * The native app uses platform fetch, which has no same-origin policy, so this
 * is never needed in production and stays off unless DEV_ALLOW_ORIGIN is set.
 * It exists so `expo start --web` (served from a different port) can talk to a
 * local server while developing the app UI.
 */
if (DEV_ALLOW_ORIGIN) {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', DEV_ALLOW_ORIGIN);
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-None-Match');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Expose-Headers', 'ETag');
    if (req.method === 'OPTIONS') await reply.code(204).send();
  });
  app.log.warn(`CORS enabled for ${DEV_ALLOW_ORIGIN} -- development only.`);
}

/* ------------------------------------------------------------------ *
 * API -- Clerk-authenticated
 * ------------------------------------------------------------------ */

const authed = { preHandler: requireClerkSession };

/** Everything from the start of today onwards, grouped client-side. */
app.get('/api/schedule', authed, async (req, reply) => {
  const state = await store.load();
  const now = DateTime.now().setZone(RESORT_TZ);
  const cutoff = now.startOf('day');

  const upcoming = Object.values(state.occurrences)
    .filter((o) => {
      const start = DateTime.fromISO(o.startsAt);
      return start.isValid && start >= cutoff;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  // The ETag must cover everything the client acts on, not just the event list.
  //
  // It deliberately excludes `now` (which changes every request and would make
  // every revalidation a full download) but it MUST include leadMinutes: the
  // app caches this payload and schedules reminders from the cached
  // leadMinutes, so hashing only the occurrences meant a lead-time change
  // produced an unchanged ETag, a 304, and an app that kept arming reminders
  // at the old lead time indefinitely.
  const etag = `W/"${createHash('sha256')
    .update(
      JSON.stringify({
        occurrences: upcoming,
        leadMinutes: LEAD_MINUTES,
        timezone: RESORT_TZ,
      }),
    )
    .digest('base64url')
    .slice(0, 27)}"`;

  reply.header('ETag', etag);
  reply.header('Cache-Control', 'private, max-age=0, must-revalidate');

  if (req.headers['if-none-match'] === etag) {
    return reply.code(304).send();
  }

  return {
    now: now.toISO(),
    timezone: RESORT_TZ,
    leadMinutes: LEAD_MINUTES,
    lastScrapeAt: state.lastScrapeAt,
    lastScrapeError: state.lastScrapeError,
    daytimeSourceChangedAt: state.daytimeSourceChangedAt ?? null,
    occurrences: upcoming,
  };
});

app.get('/api/config', authed, async (req) => {
  const id = clerkOwnerId(req)!;
  const state = await store.load();
  return {
    leadMinutes: LEAD_MINUTES,
    timezone: RESORT_TZ,
    enabled: state.preferences?.[id] ?? { entertainment: true, daytime: true },
  };
});

app.post<{ Body: { enabled: Record<string, boolean> } }>(
  '/api/preferences',
  authed,
  async (req) => {
    const id = clerkOwnerId(req)!;
    const enabled = normaliseEnabled(req.body?.enabled);
    await store.update((s) => {
      s.preferences ??= {};
      s.preferences[id] = enabled;
    });
    return { ok: true, enabled };
  },
);

/* ------------------------------------------------------------------ *
 * ICS feed -- query-token auth, since calendar clients cannot do OAuth
 * ------------------------------------------------------------------ */

app.get<{ Querystring: { key?: string; only?: string } }>(
  '/feed.ics',
  async (req, reply) => {
    if (!ICS_TOKEN || req.query.key !== ICS_TOKEN) {
      return reply.code(404).type('text/plain').send('Not found');
    }

    const state = await store.load();
    const categories = req.query.only
      ? (req.query.only.split(',').filter((c) =>
          (CATEGORIES as readonly string[]).includes(c),
        ) as Category[])
      : undefined;

    const ics = buildIcs(Object.values(state.occurrences), { categories });

    return reply
      .type('text/calendar; charset=utf-8')
      .header('Content-Disposition', 'inline; filename="atlantica.ics"')
      .send(ics);
  },
);

/** Unauthenticated liveness probe -- deliberately leaks nothing. */
app.get('/healthz', async () => {
  const state = await store.load();
  return {
    ok: true,
    occurrences: Object.keys(state.occurrences).length,
    lastScrapeAt: state.lastScrapeAt,
    lastScrapeError: state.lastScrapeError,
    daytimeSourceChangedAt: state.daytimeSourceChangedAt ?? null,
  };
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function normaliseEnabled(input?: Record<string, boolean>): Record<Category, boolean> {
  const out = {} as Record<Category, boolean>;
  for (const c of CATEGORIES) out[c] = input?.[c] ?? true;
  return out;
}

async function boot() {
  if (!clerkConfigured()) {
    app.log.error(
      'CLERK_SECRET_KEY or CLERK_JWT_KEY must be set -- refusing to start rather ' +
        'than serving the schedule with no authentication.',
    );
    process.exit(1);
  }
  if (!ICS_TOKEN) {
    app.log.warn('ICS_TOKEN not set -- the calendar feed will return 404.');
  }

  const result = await runScrape();
  app.log.info(
    `initial scrape: ${result.entertainment} entertainment, ${result.daytime} daytime` +
      (result.errors.length ? ` (errors: ${result.errors.join('; ')})` : ''),
  );

  cron.schedule(CRON.scrape, async () => {
    try {
      const r = await runScrape();
      app.log.info(`scrape: ${r.entertainment} entertainment, ${r.daytime} daytime`);
      await store.pruneOld(
        DateTime.now().setZone(RESORT_TZ).minus({ days: 3 }).toJSDate(),
      );
    } catch (err) {
      app.log.error({ err }, 'scrape failed');
    }
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`listening on ${HOST}:${PORT} (resort time ${RESORT_TZ})`);
}

boot().catch((err) => {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
});
