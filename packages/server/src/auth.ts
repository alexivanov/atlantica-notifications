import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { COOKIE_SECRET, INVITE_TOKENS } from './config.js';

/**
 * Access control sized for exactly two people and a public hotel schedule.
 *
 * There are no accounts and no passwords. Each person gets one unguessable
 * invite link; opening it swaps the token for a signed, httpOnly cookie that
 * lasts the trip. No personal data is stored beyond a push endpoint.
 */

const COOKIE = 'atl_session';
const MAX_AGE_DAYS = 60;

export function isConfigured(): boolean {
  return INVITE_TOKENS.length > 0 && COOKIE_SECRET.length >= 16;
}

/** Constant-time compare so a token can't be recovered by timing the endpoint. */
export function matchInviteToken(token: string): string | null {
  const candidate = Buffer.from(token);
  for (const known of INVITE_TOKENS) {
    const buf = Buffer.from(known);
    if (buf.length === candidate.length && timingSafeEqual(buf, candidate)) {
      return known;
    }
  }
  return null;
}

function sign(value: string): string {
  return createHmac('sha256', COOKIE_SECRET).update(value).digest('base64url');
}

/**
 * Stable per-person id derived from their invite token.
 *
 * A hash, never the token itself, so a leaked cookie cannot be replayed as an
 * invite link. Shared by the cookie and bearer paths so the same person keeps
 * one identity -- and therefore one set of category preferences -- whether they
 * are on the PWA or the native app.
 */
export function ownerId(inviteToken: string): string {
  return createHmac('sha256', COOKIE_SECRET)
    .update(inviteToken)
    .digest('base64url')
    .slice(0, 16);
}

export function issueSession(reply: FastifyReply, owner: string): void {
  const issuedAt = Date.now();
  const id = ownerId(owner);
  const payload = `${id}.${issuedAt}`;
  const value = `${payload}.${sign(payload)}`;

  reply.setCookie(COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: MAX_AGE_DAYS * 24 * 60 * 60,
  });
}

export function readSession(req: FastifyRequest): string | null {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;

  const idx = raw.lastIndexOf('.');
  if (idx < 0) return null;

  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [id, issuedAt] = payload.split('.');
  if (!id || !issuedAt) return null;

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_DAYS * 864e5) return null;

  return id;
}

/* ------------------------------------------------------------------ *
 * Bearer tokens for native clients
 *
 * The PWA uses the signed cookie above; a native app cannot reasonably hold
 * one, so it redeems an invite token once for a long-lived bearer token kept
 * in the iOS Keychain. Both paths are accepted so the PWA keeps working
 * unchanged.
 * ------------------------------------------------------------------ */

/** Issue a new device token. Returned once, in plaintext, then only stored hashed. */
export function mintDeviceToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/**
 * Hashed with the cookie secret rather than stored raw, so a leaked state file
 * does not hand over working credentials.
 */
export function hashToken(token: string): string {
  return createHmac('sha256', COOKIE_SECRET).update(token).digest('base64url');
}

function readBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Resolve the caller's identity from either auth scheme.
 *
 * Returns the owner id, or null. Device lookup is delegated so this module
 * stays free of a store import (which would be a cycle).
 */
export function readIdentity(
  req: FastifyRequest,
  lookupDevice: (tokenHash: string) => string | null,
): string | null {
  const bearer = readBearer(req);
  if (bearer) {
    const owner = lookupDevice(hashToken(bearer));
    if (owner) return owner;
    // A bearer token was offered and rejected -- do not silently fall through
    // to the cookie, or a stale app install would appear to work.
    return null;
  }
  return readSession(req);
}

/** Fastify preHandler that rejects anything without a valid session. */
export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!currentIdentity(req)) {
    await reply.code(401).send({ error: 'unauthorised' });
  }
}

/**
 * Set by the server at boot to wire in the device lookup, keeping auth.ts free
 * of a circular dependency on the store.
 */
let deviceLookup: (tokenHash: string) => string | null = () => null;

export function setDeviceLookup(fn: (tokenHash: string) => string | null): void {
  deviceLookup = fn;
}

export function currentIdentity(req: FastifyRequest): string | null {
  return readIdentity(req, deviceLookup);
}
