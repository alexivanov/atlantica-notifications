import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '@clerk/backend';
import {
  ALLOWED_EMAILS,
  ALLOWED_USER_IDS,
  CLERK,
  OPEN_SIGNUP,
} from './config.js';

/**
 * Clerk-based authentication.
 *
 * Clerk answers *who* someone is. It does not answer whether they are allowed
 * here -- with open sign-up, anyone who registers would otherwise get the
 * schedule. `isAuthorized` below is that gate, kept as a pure function so it can
 * be tested directly rather than inferred from an end-to-end pass.
 */

export interface SessionClaims {
  /** Clerk user id. Stable, and used as the owner id for preferences. */
  sub: string;
  /**
   * Only present if the Clerk session token has been customised to include it.
   * The gate must not depend on it -- hence ids being the primary allowlist.
   */
  email?: string;
}

export class AuthzError extends Error {}

/**
 * The single authorization decision for the whole service.
 *
 * Deliberately one function with no I/O: opening access to more people is a
 * config change (`OPEN_SIGNUP`, or another entry in the allowlists) rather than
 * a code change, and the security boundary is somewhere a test can reach.
 */
export function isAuthorized(
  claims: SessionClaims,
  opts: {
    openSignup?: boolean;
    allowedUserIds?: string[];
    allowedEmails?: string[];
  } = {},
): boolean {
  const openSignup = opts.openSignup ?? OPEN_SIGNUP;
  if (openSignup) return true;

  const ids = opts.allowedUserIds ?? ALLOWED_USER_IDS;
  const emails = opts.allowedEmails ?? ALLOWED_EMAILS;

  // No lists configured and not open: fail closed. An empty allowlist must
  // never mean "everyone" -- that is how a misconfigured deploy quietly becomes
  // a public one.
  if (ids.length === 0 && emails.length === 0) return false;

  if (claims.sub && ids.includes(claims.sub)) return true;

  if (claims.email) {
    const email = claims.email.trim().toLowerCase();
    if (emails.includes(email)) return true;
  }

  return false;
}

export function isConfigured(): boolean {
  // Either key works: jwtKey verifies locally, secretKey falls back to Clerk.
  return Boolean(CLERK.jwtKey || CLERK.secretKey);
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/**
 * Verify the caller's Clerk session token.
 *
 * Returns claims, or null when there is no usable token. Throws AuthzError when
 * the token is valid but the person is not on the allowlist, so the caller can
 * distinguish 401 (who are you?) from 403 (I know who you are, no).
 */
export async function authenticate(
  req: FastifyRequest,
): Promise<SessionClaims | null> {
  const token = bearer(req);
  if (!token) return null;

  try {
    const payload = await verifyToken(token, {
      ...(CLERK.jwtKey ? { jwtKey: CLERK.jwtKey } : { secretKey: CLERK.secretKey }),
      ...(CLERK.authorizedParties.length
        ? { authorizedParties: CLERK.authorizedParties }
        : {}),
    });

    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!sub) return null;

    // `email` only exists if the Clerk session token was customised to add it.
    const raw = payload as Record<string, unknown>;
    const email =
      typeof raw.email === 'string'
        ? raw.email
        : typeof raw.primary_email_address === 'string'
          ? raw.primary_email_address
          : undefined;

    const claims: SessionClaims = { sub, email };

    if (!isAuthorized(claims)) {
      throw new AuthzError('not on the allowlist');
    }

    return claims;
  } catch (err) {
    if (err instanceof AuthzError) throw err;
    // Expired, malformed, wrong issuer -- all "not signed in" from here.
    return null;
  }
}

/** Fastify preHandler. 401 when unauthenticated, 403 when not permitted. */
export async function requireClerkSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const claims = await authenticate(req);
    if (!claims) {
      await reply.code(401).send({ error: 'unauthorised' });
      return;
    }
    // Stashed so handlers can read the owner id without re-verifying.
    (req as FastifyRequest & { clerk?: SessionClaims }).clerk = claims;
  } catch (err) {
    if (err instanceof AuthzError) {
      await reply.code(403).send({ error: 'not permitted' });
      return;
    }
    await reply.code(401).send({ error: 'unauthorised' });
  }
}

/** Owner id for the current request, once requireClerkSession has run. */
export function clerkOwnerId(req: FastifyRequest): string | null {
  return (req as FastifyRequest & { clerk?: SessionClaims }).clerk?.sub ?? null;
}
