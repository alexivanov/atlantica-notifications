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

async function main() {
  // 1. Close sign-up. Without this anyone who finds the app can register, and
  //    Clerk would happily authenticate them.
  console.log('Restricting sign-up to the allowlist…');
  await clerk.instance.updateRestrictions({
    allowlist: true,
    blocklist: false,
  });
  console.log('  done — sign-up now requires an allowlisted address.\n');

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
      await clerk.allowlistIdentifiers.createAllowlistIdentifier({
        identifier: email,
        notify: false,
      });
      console.log(`allowlist: ${email} added`);
    }

    if (invited.has(email)) {
      console.log(`invite:    ${email} (already pending)`);
    } else {
      try {
        await clerk.invitations.createInvitation({ emailAddress: email });
        console.log(`invite:    ${email} sent`);
      } catch (err) {
        // Most often "already has an account", which is fine.
        console.log(`invite:    ${email} skipped (${(err as Error).message})`);
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
    console.warn(`  could not fetch JWKS: ${(err as Error).message}`);
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
  console.log(
    '\nStill to do by hand in the dashboard (no API for these):\n' +
      '  - enable Email verification code as a sign-in method\n' +
      '  - enable Apple as a social connection\n' +
      '  - optionally add `email` to the session token so the email allowlist works',
  );
}

main().catch((err) => {
  console.error('\nFailed:', (err as Error).message);
  process.exit(1);
});
