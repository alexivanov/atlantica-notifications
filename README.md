# Atlantica resort event reminders

Reminders 30 minutes before entertainment and daytime activities at Atlantica
Imperial Resort, for two people.

The resort publishes its schedule only through a lobby kiosk website. A Node
service scrapes it; a native app turns that into alarms on the phone.

```
packages/
  shared/   TypeScript types + reminder-selection logic  →  used by both
  server/   scraper, JSON API, ICS feed, and the original PWA
  app/      Expo (React Native) app — iOS now, Android later
```

**Delivery is on-device.** The app schedules local notifications from the
fetched schedule: no APNs, no push certificates, no server in the reminder path,
and they fire in airplane mode. The server's only job is to say *what* is on.

The original PWA and the ICS calendar feed still work and are still served —
they cost nothing and are the fallback if a build expires.

## Setup

```sh
npm install
npm test          # 35 tests: 12 shared, 23 server
npm run build
```

Server secrets (`packages/server/.env`, see `.env.example`):

```sh
node -e "const c=require('crypto');console.log('INVITE_TOKENS='+[0,0].map(()=>c.randomBytes(24).toString('base64url')).join(','));console.log('ICS_TOKEN='+c.randomBytes(24).toString('base64url'));console.log('COOKIE_SECRET='+c.randomBytes(32).toString('base64url'))"
npm run keys -w @atlantica/server   # VAPID pair, for the PWA's web push
```

Run the server, and the app against it:

```sh
npm start                                        # server on :8080
DEV_ALLOW_ORIGIN=http://127.0.0.1:8100 npm start # if using `expo start --web`

cd packages/app
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8080 npx expo start
```

## Building the app

Requires **Xcode** (not just Command Line Tools) and an Apple Developer account.
The team ID is set in `identifiers.js`; override with `APPLE_TEAM_ID` if needed.

```sh
cd packages/app
npx expo prebuild --platform ios      # generates ios/ incl. the widget target
npx expo run:ios                      # or: eas build --profile development
```

`ios/` is generated and gitignored — never edit it by hand, `--clean` wipes it.

The **App Group** `group.com.alexivanov.atlantica` must exist on the Apple
Developer portal and be enabled for both the app and the widget App IDs.
`eas build` registers capabilities automatically; building locally for a device
may require adding it by hand at developer.apple.com → Identifiers.

The widget and Live Activity need a **custom dev client** — they do not exist in
Expo Go. Use the `development` EAS profile, or `expo run:ios` locally.

For the partner's phone: `eas build --profile production` → `eas submit` →
TestFlight invite. Builds last 90 days.

## Sign-in

The same invite links as the PWA (`https://<host>/s/<token>`) work in the app.
Paste one into the sign-in screen, or open `atlantica://s/<token>` on the phone.
It is exchanged once for a long-lived bearer token kept in the Keychain; the
server only ever stores a hash of it.

Both clients derive the same identity from an invite token, so category
toggles follow the person across the PWA and the app.

## Things that were not obvious

These are the traps this codebase exists to handle. Most were found by reading
the actual data, not by guessing.

**Event IDs are not unique per occurrence.** The kiosk reuses `id=3243`
("DJ Set", Sky Bar) on three different days. Everything keys on
`category|date|time|id` instead. Keying on the event id would send one reminder
and silently swallow the other two.

**Day headings are sticky.** The `.day` heading renders only on the *first* card
of each day group; later cards that day have an empty day cell. The parser
carries the last-seen day forward, or roughly half the schedule is misdated.

**Dates carry no year.** The site prints `01.08.` and expects you to work it out.
The year is inferred by proximity to today (handling the Dec→Jan rollover), and
cross-checked against the weekday name in the label when present — a mismatch
throws rather than quietly reminding you on the wrong day.

**iOS silently caps pending local notifications at 64.** One week here is ~63
occurrences, right on the limit — "schedule everything" would appear to work
while dropping whichever reminders sorted last. `selectReminders()` in
`packages/shared` arms the soonest 55 and re-arms on every foreground and
background refresh. This is the one piece of real client logic, so it is shared
and unit-tested rather than written twice.

**Alarms are pinned to absolute instants.** `startsAt` carries the `+03:00`
offset and is used directly; the wall-clock `21:00` is never re-parsed. The
phone may not be set to resort time.

**The daytime PDF is not parsed at runtime.** Its text layer extracts as
character-split, locale-tagged fragments with no reliable column→weekday
mapping — parsing it produced a *wrong* timetable (it implied a full Wednesday
and Sunday; the real programme has 4 activities each). It is a static grid, so
it was transcribed once by rendering the PDF to an image and reading it:

```sh
pdftoppm -png -r 150 day.pdf grid    # brew install poppler
```

The scraper watches the PDF's URL and content hash and notifies when the resort
publishes a new one — that is the signal to re-transcribe
`packages/server/data/daytime-schedule.json`.

**A failed scrape never empties the schedule.** Occurrences are upserted and
never deleted by a run returning fewer results; a parse yielding zero events
raises rather than reporting "nothing on tonight".

## Platform notes

- **Widget and Live Activity are iOS-only.** They are native extensions by
  definition (WidgetKit/ActivityKit, Swift, under `packages/app/targets/`).
  Android has no Live Activity equivalent and uses Glance for widgets, so those
  are a separate later decision — they do not port.
- `AtlanticaActivityAttributes` must be compiled into **both** the app target
  and the widget extension — the app starts the activity, the extension renders
  it. The canonical file lives in `modules/atlantica-live-activity/ios/`
  (CocoaPods silently ignores sources outside a pod's root, so it has to be
  there) and `targets/_shared/` symlinks to it. Two separate declarations would
  compile and then silently never match.
- The Live Activity pod is named `AtlanticaLiveActivity`, **not**
  `AtlanticaWidget`. The widget extension target already produces a module by
  that name, and the collision made `import AtlanticaWidget` in Expo's
  generated provider resolve to the extension — so the module's class was
  "not found" despite compiling fine.
- A local Expo module's podspec needs `DEFINES_MODULE => YES`; without it the
  pod compiles but exports no Swift module for the provider to import.
- **Android**, when added, needs `SCHEDULE_EXACT_ALARM` (already declared) for
  alarms to fire at an exact time rather than being batched.
- `DEV_ALLOW_ORIGIN` and the localStorage fallback in `src/storage.ts` exist
  only so `expo start --web` works during development. Neither is used on device.

## Timezone

All date maths runs explicitly in `Europe/Athens` (EEST, UTC+3 in summer), never
the host's zone — the server runs in UTC and the site publishes bare wall-clock
times. Greece and Cyprus share identical EET/EEST rules, so the same constant is
correct for either Atlantica property.
