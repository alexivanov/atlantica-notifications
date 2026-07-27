import { createHmac, timingSafeEqual } from 'node:crypto';
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

export function issueSession(reply: FastifyReply, owner: string): void {
  const issuedAt = Date.now();
  // Store a hash of the invite token, never the token itself, so a leaked
  // cookie can't be replayed as an invite link.
  const id = createHmac('sha256', COOKIE_SECRET)
    .update(owner)
    .digest('base64url')
    .slice(0, 16);
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

/** Fastify preHandler that rejects anything without a valid session. */
export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!readSession(req)) {
    await reply.code(401).send({ error: 'unauthorised' });
  }
}
