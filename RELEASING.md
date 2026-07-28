# Releasing to TestFlight

Everything that can be prepared ahead of time is done: bundle id, App Group,
team ID, entitlements, build profiles and submit config are all committed, and
the project compiles (`BUILD SUCCEEDED` for the app, widget and Live Activity).

What remains needs credentials — an Expo password, and an Apple ID with 2FA —
so these steps have to be run by you.

Run everything from `packages/app`.

## 1–2. Log in and link the project — DONE

Logged in as `alexivanovv`, project linked as
`@alexivanovv/atlantica-notifications`
(`cf03ff42-f62f-4b3e-b358-016fa67f255b`, set in `identifiers.js`).

## 3. Build

**This step must be interactive** — a non-interactive run stops at
"Distribution Certificate is not validated for non-interactive builds". EAS has
already confirmed it sees both targets and will provision each separately:

```
- Target: Atlantica         com.alexivanov.atlantica
- Target: AtlanticaWidget   com.alexivanov.atlantica.widget
```

```sh
eas build --platform ios --profile production
```

On first run EAS asks to generate a Distribution Certificate and Provisioning
Profiles — say yes. It signs in to Apple with your Apple ID and 2FA, then
registers the bundle ids and the App Group capability automatically:

- `com.alexivanov.atlantica` — the app
- `com.alexivanov.atlantica.widget` — the widget extension
- `group.com.alexivanov.atlantica` — the App Group both share

If it does *not* offer to create the App Group, add it by hand at
developer.apple.com → Identifiers → App Groups, and enable it on both App IDs.
A mismatch here does not fail the build — the widget just silently shows
nothing, which is miserable to debug.

The build runs on EAS's machines (~15–25 min). It does not need your laptop
awake once it has uploaded.

## 4. Create the App Store Connect record

Before submitting, the app must exist at
[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Apps → **+** →
New App:

- Platform: iOS
- Bundle ID: `com.alexivanov.atlantica`
- SKU: anything, e.g. `atlantica-notifications`

## 5. Submit

```sh
eas submit --platform ios --profile production --latest
```

Processing on Apple's side takes 5–15 minutes. TestFlight builds expire after
**90 days**.

## 6. Add your partner

App Store Connect → TestFlight → Internal Testing → add them by Apple ID email.
Internal testers need no Beta App Review, so they get it immediately. They
install the TestFlight app, then Atlantica.

**Internal testing is capped at 100 testers and requires each person to be added
to your team** (as at least a "Customer Support" user, which is free). If you
would rather not add your partner to the team, use External Testing instead —
that allows a public link but triggers a Beta App Review, usually a day or so.

## 7. First-run checks on a real device

Two things could not be verified in a simulator, so check them once:

1. **Sign in.** Paste the invite link. An unsigned simulator build has no
   Keychain entitlement, so this path has only been tested against a failure —
   it should now succeed and persist across a relaunch.
2. **A reminder actually fires.** Temporarily lower the lead time on the server
   so you do not have to wait for a real 30-minute window:

   ```sh
   fly secrets set LEAD_MINUTES=2 -a atlantica-notifications
   # open the app, pull to refresh so it re-arms, then kill the app entirely
   # and wait for the next event -- it must fire with the app closed
   fly secrets set LEAD_MINUTES=30 -a atlantica-notifications
   ```

   Note the app reads `leadMinutes` from `/api/schedule`, so it picks the change
   up on the next refresh. Re-arm by foregrounding the app after each change.

Also worth confirming: add the widget to the home screen, and check a Live
Activity appears when an event is within two hours.

## Meanwhile

The ICS calendar feed needs no build at all and works today:

```
https://atlantica-notifications.fly.dev/feed.ics?key=<ICS_TOKEN>
```

Settings → Apps → Calendar → Accounts → Add Account → Other → Add Subscribed
Calendar. Native alerts, 30 minutes before, on both phones.
