# Atlantica notifications

Reminders and dining info for one hotel resort, for two people. npm workspaces:
`packages/shared` (pure logic + committed data), `packages/server` (Fastify,
scrapes the kiosk site), `packages/app` (Expo/React Native, iOS today).

## Commands

```
npm test              # shared + server; the app's `test` is `tsc --noEmit`
npm run build         # shared, then server
npm start             # server
npm run app           # Expo dev server
```

`@atlantica/shared` publishes from `dist/`, which is **gitignored**. Anything
that consumes it must build it first — that is what
`packages/app`'s `eas-build-post-install` script is for. When changing build
wiring, test it the only way that is honest: `rm -rf packages/shared/dist` and
run the consumer from clean. A fresh EAS clone has no `dist`, and this has
broken a build before.

## The source data is hostile; treat it accordingly

The kiosk site (`kioskcms.biz`) has no API. Two rules, both learned by shipping
something wrong:

**Never parse prose or PDFs for times.** Opening hours and the daytime
timetable are bilingual prose with inconsistent dashes, meal labels and
exceptions buried mid-sentence ("Except Saturdays", "only for Red carpet
guests"). Parsing them produced a *plausible, wrong* timetable — worse than
none, because nothing downstream catches it. Render the PDF to an image
(`pdftoppm`) and transcribe by hand. The same goes for `venues.json`.

**Menus and venues are static committed JSON. Nothing scrapes them at runtime.**
`packages/shared/scripts/capture-menus.ts` was a one-off; it is kept for
provenance, not run on a schedule. Regenerating it is a deliberate act with
hand spot-checks against the live pages afterwards.

**All-inclusive rates differ per venue and per category.** Agora is 50%, the à
la carte restaurants 30%, and The Cove is 50% on drinks but 30% on `Snacks` and
`Sushi`. Assuming one global rate silently displays wrong prices. Rates live in
the capture script; `finalPrice` is resolved at capture time so the app never
does the arithmetic.

## Time

Every instant is resolved in the **resort's** timezone (`Europe/Athens`), never
the device's. Occurrences carry absolute `startsAt` instants; fire times are
derived from those and never re-derived from a wall clock. `to: "00:00"` on a
service period means *next day* — treat it as midnight-crossing or every bar
reads as closed all evening.

## Caching

Any value that changes a response must be in its ETag. `leadMinutes` was
omitted once, so the server returned 304 and the app stayed frozen on the old
lead time with no error anywhere. When adding a knob, add it to the ETag.

## Auth

Clerk, invite-only. Two independent gates, and both matter:

- Clerk `sign_up.mode: "restricted"` — only invited addresses can create an
  account. This also blocks **Sign in with Apple as a first-time sign-up**,
  which surfaces as "you're not authorised to do this action". The account has
  to exist first, via the email-code invitation.
- `packages/server/src/clerkAuth.ts` — `isAuthorized` **fails closed**: with no
  allowlist and `OPEN_SIGNUP` unset, nobody gets in. Keep it that way.

Apple's "Hide My Email" hands over a `@privaterelay.appleid.com` address, which
matches neither the invitation nor the allowlist. It cannot be made to work
without weakening the gate.

Keys are still a Clerk **development** instance (`pk_test_`/`sk_test_`). Moving
to production needs new values in Fly secrets *and* `packages/app/eas.json`,
plus a rebuild.

## EAS builds

Waiting on a build must be **bounded**. Parsing `eas build:view` output span
forever once and had to be killed. Poll the GraphQL API with a hard iteration
ceiling and print each tick:

```
curl -s https://api.expo.dev/graphql -H "expo-session: $TOKEN" \
  -d '{"query":"query($id:ID!){builds{byId(buildId:$id){status}}}", ...}'
```

`eas submit:list` **does not exist**; submissions are only reachable through
GraphQL (`submissions{byId(submissionId:)}` — note the field is `error`, not
`submissionInfo`). The session token is at `~/.expo/state.json`
→ `auth.sessionSecret`.

## Verifying UI

macOS blocks this environment from sending taps to the iOS simulator, so
simulator screenshots can be taken but not driven. Verify layout and flows
through the **web build** in Chrome (`npm run app`, then the localhost URL)
before cutting a build.
