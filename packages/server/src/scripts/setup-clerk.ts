/**
 * Configures a Clerk instance for this app.
 *
 * Clerk has no CLI, and creating an *application* is dashboard-only -- the
 * Backend API only reaches inside an application that already exists. So this
 * covers everything after that first click:
 *
 *   - restricts sign-up to an allowlist (so registration is not open)
 *   - allowlists each address and sends an invitation
 *   - prints the values to set as server secrets, including the JWKS public key
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_... npx tsx src/scripts/setup-clerk.ts you@x.com partner@y.com
 *
 * Safe to re-run: existing allowlist entries and invitations are left alone.
 */
import { createClerkClient } from '@clerk/backend';

const secretKey = process.env.CLERK_SECRET_KEY;
const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);

if (!secretKey) {
  console.error('Set CLERK_SECRET_KEY (from the Clerk dashboard → API keys).');
  process.exit(1);
}
if (emails.length === 0) {
  console.error('Pass the email addresses to invite, space separated.');
  process.exit(1);
}
if (secretKey.startsWith('sk_live_')) {
  console.warn('Note: this is a LIVE key, so it is configuring production.\n');
}

// Narrowed after the guards above, so downstream use is not `string | undefined`.
const key: string = secretKey;
const clerk = createClerkClient({ secretKey: key });

/**
 * Clerk API errors carry their detail in an `errors` array; the top-level
 * `message` is often empty, which makes a bare `err.message` useless.
 */
function describe(err: unknown): string {
  const e = err as {
    status?: number;
    message?: string;
    errors?: { message?: string; longMessage?: string; code?: string }[];
  };
  const parts = (e.errors ?? [])
    .map((x) => x.longMessage ?? x.message ?? x.code)
    .filter(Boolean);
  if (parts.length) return `${parts.join('; ')}${e.status ? ` (HTTP ${e.status})` : ''}`;
  return e.message || `${JSON.stringify(err)}`.slice(0, 300);
}

async function main() {
  // Fail early and clearly if the key is not usable at all, rather than
  // surfacing it as a confusing failure on the first real call.
  try {
    const inst = await clerk.instance.get();
    console.log(`Connected to Clerk instance ${inst.environmentType ?? ''}\n`);
  } catch (err) {
    console.error(`Could not reach Clerk with that secret key:\n  ${describe(err)}`);
    process.exit(1);
  }

  // 1. Close sign-up. Without this anyone who finds the app can register, and
  //    Clerk would happily authenticate them.
  console.log('Checking sign-up restrictions…');
  let restricted = false;
  try {
    await clerk.instance.updateRestrictions({ allowlist: true });
    restricted = true;
    console.log('  allowlist enabled — sign-up now requires an allowlisted address.\n');
  } catch (err) {
    const detail = describe(err);
    // Clerk's newer `sign_up_mode` supersedes the legacy `allowlist` flag and
    // the two are mutually exclusive. Being rejected for this reason means
    // sign-up is ALREADY restricted, which is the state we wanted.
    if (/sign-?up mode is set to restricted/i.test(detail)) {
      restricted = true;
      console.log('  already restricted — sign-up mode is "restricted". Nothing to do.\n');
    } else {
      // Keep going: the allowlist and invitations below are still worth setting
      // up, and the server-side gate protects access regardless.
      console.warn(`  could not set restrictions: ${detail}`);
      console.warn('  set it by hand: Clerk dashboard → Configure → Restrictions\n');
    }
  }

  // 2. Allowlist + invite each address.
  const existing = await clerk.allowlistIdentifiers.getAllowlistIdentifierList();
  const already = new Set(
    (existing.data ?? []).map((i) => String(i.identifier).toLowerCase()),
  );

  const invites = await clerk.invitations.getInvitationList({ status: 'pending' });
  const invited = new Set(
    (invites.data ?? []).map((i) => String(i.emailAddress).toLowerCase()),
  );

  for (const email of emails) {
    if (already.has(email)) {
      console.log(`allowlist: ${email} (already there)`);
    } else {
      try {
        await clerk.allowlistIdentifiers.createAllowlistIdentifier({
          identifier: email,
          notify: false,
        });
        console.log(`allowlist: ${email} added`);
      } catch (err) {
        console.log(`allowlist: ${email} failed (${describe(err)})`);
      }
    }

    if (invited.has(email)) {
      console.log(`invite:    ${email} (already pending)`);
    } else {
      try {
        await clerk.invitations.createInvitation({ emailAddress: email });
        console.log(`invite:    ${email} sent`);
      } catch (err) {
        // Most often "already has an account", which is fine.
        console.log(`invite:    ${email} skipped (${describe(err)})`);
      }
    }
  }

  // 3. The JWKS public key, so the server can verify tokens without calling
  //    Clerk on every request.
  console.log('\nFetching JWKS public key…');
  let jwtKey = '';
  try {
    const jwks = await clerk.jwks.getJwks();
    jwtKey = JSON.stringify(jwks);
  } catch (err) {
    console.warn(`  could not fetch JWKS: ${describe(err)}`);
  }

  // 4. Any users who already exist become the id allowlist -- ids are stable
  //    and keep personal data out of the server config.
  const users = await clerk.users.getUserList({ limit: 100 });
  const ids = (users.data ?? [])
    .filter((u) =>
      u.emailAddresses.some((e) =>
        emails.includes(e.emailAddress.toLowerCase()),
      ),
    )
    .map((u) => u.id);

  console.log('\n--- set these on the server ---\n');
  console.log('fly secrets set \\');
  console.log(`  CLERK_SECRET_KEY='${key.slice(0, 12)}…' \\   # use the real value`);
  console.log(`  ALLOWED_EMAILS='${emails.join(',')}' \\`);
  if (ids.length) console.log(`  ALLOWED_USER_IDS='${ids.join(',')}' \\`);
  console.log("  OPEN_SIGNUP='false'");
  if (jwtKey) {
    console.log(
      '\nCLERK_JWT_KEY: copy the PEM from Clerk dashboard → API keys → "JWKS public key".',
    );
  }
  if (!restricted) {
    console.log(
      '\n!! Sign-up restrictions were NOT applied. Until you enable the\n' +
        '   Allowlist in the dashboard, anyone can register with Clerk --\n' +
        '   only the server-side ALLOWED_* lists are stopping them.',
    );
  }

  console.log(
    '\nStill to do by hand in the dashboard (no API for these):\n' +
      '  - enable Email verification code as a sign-in method\n' +
      '  - enable Apple as a social connection\n' +
      '  - optionally add `email` to the session token so the email allowlist works',
  );
}

main().catch((err) => {
  console.error(`\nFailed: ${describe(err)}`);
  process.exit(1);
});
