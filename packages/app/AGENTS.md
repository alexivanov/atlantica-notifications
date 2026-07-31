# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

SDK 57 / React Native 0.86 / React 19, New Architecture. APIs that moved and
cost time here:

- `expo-file-system` is a class API — `new File(Paths.document, …)`, not
  `FileSystem.documentDirectory` plus free functions.
- Notification triggers are typed: `SchedulableTriggerInputTypes.DATE`.

## iOS keeps only the 64 soonest pending notifications

Anything past that is dropped silently — no error, no warning, the reminder
just never fires. `MAX_SCHEDULED = 55` in `packages/shared/src/selectReminders.ts`
leaves headroom. One week of resort events is roughly 63 occurrences, so this
ceiling is hit in normal use, not an edge case.

A trigger's shape is platform-specific and not reliably readable back, so the
intended fire time is stored in the notification's `data` as an ISO string.
Reading it off the trigger rendered `--:--` on screen.

## Imports must be extensionless

`packages/shared` is NodeNext and its own sources import `./foo.js`. Metro
cannot resolve a `.js` specifier pointing at a `.ts` file, so **app sources
import without extensions**. Copying an import out of `shared` breaks the
bundler.

## `Link asChild` will not take a style array

`<Link asChild><Pressable style={[a, b]} /></Link>` dropped the styling
silently in one expo-router version and became a hard error in another. Pass a
flat style object, or `StyleSheet.flatten([...])`.

## Native modules are Expo Modules, not bridge modules

`NativeModules.AtlanticaLiveActivity` is always `undefined` — Expo Modules are
not on the legacy bridge. Use
`requireOptionalNativeModule('AtlanticaLiveActivity')`, which also degrades
correctly on a build where the module is absent.

Live Activity specifics, each of which failed once:

- `NSSupportsLiveActivities` must be in `infoPlist` or the API is inert with no
  diagnostic. Verify it in the *built* binary, not just the config.
- Never hold activity handles in a static Swift dictionary — it does not
  survive a relaunch, and the activity then cannot be cancelled. Look them up
  from `Activity.activities`.
- The pod name must not collide with the widget extension's target name.
- Widget code targets iOS 16.2, so iOS 17-only API
  (`containerBackground(for: .widget)`) needs an `#available` gate.

## Fail visibly, not silently

An unhandled Keychain read threw and left the app on a spinner forever; a
missing `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` crashed it on launch. Both now
degrade to a readable screen (`MisconfiguredNotice`) or a null return.

Being offline must **never** sign the user out — `src/api.ts` keeps
`OfflineError` separate from `AuthError` and `ForbiddenError` for exactly that
reason.

## Dining data is bundled; the Dining tab works with no network

`src/dining.ts` reads committed JSON and nothing in it fetches. Search across
all 700 items is synchronous and needs no debouncing.
