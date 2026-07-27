import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import fstatic from '@fastify/static';
import Fastify from 'fastify';
import { DateTime } from 'luxon';
import cron from 'node-cron';
import {
  CATEGORIES,
  CRON,
  HOST,
  ICS_TOKEN,
  LEAD_MINUTES,
  PORT,
  PUBLIC_DIR,
  RESORT_TZ,
  VAPID,
  type Category,
} from './config.js';
import {
  isConfigured,
  issueSession,
  matchInviteToken,
  readSession,
  requireSession,
} from './auth.js';
import { buildIcs } from './ics.js';
import { dispatchDue, pruneOld, suppressBackfill } from './notify/dispatcher.js';
import { configurePush, sendTo } from './notify/push.js';
import { runScrape } from './scrape/index.js';
import * as store from './store.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(cookie);
await app.register(fstatic, {
  // Resolved from the working directory so it is the same path whether we run
  // from src/ or the compiled dist/.
  root: resolve(PUBLIC_DIR),
  prefix: '/',
  index: false,
});

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

/** Invite link. Swaps a one-per-person token for a session cookie. */
app.get<{ Params: { token: string } }>('/s/:token', async (req, reply) => {
  const owner = matchInviteToken(req.params.token);
  if (!owner) return reply.code(404).type('text/plain').send('Not found');
  issueSession(reply, owner);
  return reply.redirect('/');
});

app.get('/', async (req, reply) => {
  if (!readSession(req)) {
    return reply
      .code(401)
      .type('text/html')
      .send(
        '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">' +
          '<style>body{font:16px -apple-system,sans-serif;padding:2rem;text-align:center}</style>' +
          '<h1>Atlantica</h1><p>Open your personal invite link to get in.</p>',
      );
  }
  return reply.sendFile('index.html');
});

/* ------------------------------------------------------------------ *
 * API (all session-gated)
 * ------------------------------------------------------------------ */

const authed = { preHandler: requireSession };

/** Everything from now to the end of the horizon, grouped client-side. */
app.get('/api/schedule', authed, async () => {
  const state = await store.load();
  const now = DateTime.now().setZone(RESORT_TZ);
  const cutoff = now.startOf('day');

  const upcoming = Object.values(state.occurrences)
    .filter((o) => {
      const start = DateTime.fromISO(o.startsAt);
      return start.isValid && start >= cutoff;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    now: now.toISO(),
    timezone: RESORT_TZ,
    leadMinutes: LEAD_MINUTES,
    lastScrapeAt: state.lastScrapeAt,
    lastScrapeError: state.lastScrapeError,
    occurrences: upcoming,
  };
});

app.get('/api/config', authed, async (req) => {
  const id = readSession(req)!;
  const state = await store.load();
  const mine = state.subscriptions.filter((s) => s.owner === id);
  return {
    vapidPublicKey: VAPID.publicKey,
    leadMinutes: LEAD_MINUTES,
    subscribed: mine.length > 0,
    enabled: mine[0]?.enabled ?? { entertainment: true, daytime: true },
  };
});

interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  enabled?: Record<string, boolean>;
}

app.post<{ Body: SubscribeBody }>('/api/subscribe', authed, async (req, reply) => {
  const id = readSession(req)!;
  const { endpoint, keys } = req.body ?? ({} as SubscribeBody);

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return reply.code(400).send({ error: 'invalid subscription' });
  }

  const enabled = normaliseEnabled(req.body.enabled);

  await store.update((s) => {
    // One record per endpoint; re-subscribing from the same phone updates it.
    const existing = s.subscriptions.find((x) => x.endpoint === endpoint);
    if (existing) {
      existing.keys = keys;
      existing.owner = id;
      existing.enabled = enabled;
    } else {
      s.subscriptions.push({
        id: randomUUID(),
        owner: id,
        endpoint,
        keys,
        enabled,
        createdAt: new Date().toISOString(),
      });
    }
  });

  return { ok: true };
});

app.post<{ Body: { enabled: Record<string, boolean> } }>(
  '/api/preferences',
  authed,
  async (req) => {
    const id = readSession(req)!;
    const enabled = normaliseEnabled(req.body?.enabled);
    await store.update((s) => {
      for (const sub of s.subscriptions) {
        if (sub.owner === id) sub.enabled = enabled;
      }
    });
    return { ok: true, enabled };
  },
);

/** Fires a notification immediately, to prove delivery end-to-end on a phone. */
app.post('/api/test-notification', authed, async (req, reply) => {
  const id = readSession(req)!;
  const state = await store.load();
  const mine = state.subscriptions.filter((s) => s.owner === id);
  if (mine.length === 0) {
    return reply.code(400).send({ error: 'no subscription registered' });
  }
  for (const sub of mine) {
    await sendTo(sub, {
      title: 'Test notification',
      body: 'Push is working. Reminders will arrive 30 minutes before each event.',
      tag: 'test',
      url: '/',
    });
  }
  return { ok: true, sent: mine.length };
});

/* ------------------------------------------------------------------ *
 * ICS feed -- query-token auth, since calendar clients can't hold cookies
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
    subscriptions: state.subscriptions.length,
    lastScrapeAt: state.lastScrapeAt,
    lastScrapeError: state.lastScrapeError,
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
  if (!isConfigured()) {
    app.log.error(
      'INVITE_TOKENS and COOKIE_SECRET (>=16 chars) must be set -- refusing to start ' +
        'rather than serving the app with no access control.',
    );
    process.exit(1);
  }
  if (!ICS_TOKEN) {
    app.log.warn('ICS_TOKEN not set -- the calendar feed will return 404.');
  }
  configurePush();

  const state = await store.load();
  const firstRun = !state.initialised;

  const result = await runScrape();
  app.log.info(
    `initial scrape: ${result.entertainment} entertainment, ${result.daytime} daytime` +
      (result.errors.length ? ` (errors: ${result.errors.join('; ')})` : ''),
  );

  if (firstRun) {
    const n = await suppressBackfill();
    if (n > 0) {
      app.log.info(`suppressed ${n} already-in-window reminders on first run`);
    }
  }

  cron.schedule(CRON.scrape, async () => {
    try {
      const r = await runScrape();
      app.log.info(`scrape: ${r.entertainment} entertainment, ${r.daytime} daytime`);
      await pruneOld();
    } catch (err) {
      app.log.error({ err }, 'scrape failed');
    }
  });

  cron.schedule(CRON.dispatch, async () => {
    try {
      await dispatchDue();
    } catch (err) {
      app.log.error({ err }, 'dispatch failed');
    }
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`listening on ${HOST}:${PORT} (resort time ${RESORT_TZ})`);
}

boot().catch((err) => {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
});
