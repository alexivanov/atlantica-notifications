import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthorized } from '../src/clerkAuth.js';

/**
 * `isAuthorized` is the only thing standing between the schedule and anyone who
 * can create a Clerk account, so it is tested directly rather than inferred
 * from an end-to-end pass.
 */

const ALLOWED = {
  allowedUserIds: ['user_alex', 'user_partner'],
  allowedEmails: ['alex@example.com'],
  openSignup: false,
};

test('allows a listed user id', () => {
  assert.equal(isAuthorized({ sub: 'user_alex' }, ALLOWED), true);
  assert.equal(isAuthorized({ sub: 'user_partner' }, ALLOWED), true);
});

test('allows a listed email even when the id is unknown', () => {
  // Covers a fresh Clerk account whose id has not been added to the list yet.
  assert.equal(
    isAuthorized({ sub: 'user_new', email: 'alex@example.com' }, ALLOWED),
    true,
  );
});

test('email matching ignores case and surrounding whitespace', () => {
  assert.equal(
    isAuthorized({ sub: 'user_new', email: '  ALEX@Example.COM ' }, ALLOWED),
    true,
  );
});

test('rejects a signed-in user who is on neither list', () => {
  // The important case: Clerk authenticated them, we still say no.
  assert.equal(isAuthorized({ sub: 'user_stranger' }, ALLOWED), false);
  assert.equal(
    isAuthorized({ sub: 'user_stranger', email: 'someone@else.com' }, ALLOWED),
    false,
  );
});

test('fails closed when nothing is configured', () => {
  // An empty allowlist must never mean "everyone" -- that is how a
  // misconfigured deploy silently becomes a public one.
  assert.equal(
    isAuthorized(
      { sub: 'user_anyone', email: 'anyone@example.com' },
      { openSignup: false, allowedUserIds: [], allowedEmails: [] },
    ),
    false,
  );
});

test('OPEN_SIGNUP lets anyone signed in through', () => {
  assert.equal(
    isAuthorized(
      { sub: 'user_anyone' },
      { openSignup: true, allowedUserIds: [], allowedEmails: [] },
    ),
    true,
  );
});

test('a missing or empty subject is never authorised by id', () => {
  assert.equal(
    isAuthorized(
      { sub: '' },
      { openSignup: false, allowedUserIds: [''], allowedEmails: [] },
    ),
    false,
  );
});

test('an absent email does not match an allowlist entry', () => {
  assert.equal(
    isAuthorized(
      { sub: 'user_stranger' },
      { openSignup: false, allowedUserIds: [], allowedEmails: ['a@b.com'] },
    ),
    false,
  );
});
