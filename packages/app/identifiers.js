/**
 * Single source of truth for the bundle identifier and App Group.
 *
 * Plain CommonJS because it is required from both `app.config.ts` (the app
 * target) and `targets/widget/expo-target.config.js` (the widget extension),
 * and those must agree exactly -- the App Group is the only channel between the
 * app and the widget process. A mismatch does not fail the build; the widget
 * just silently renders nothing, which is a miserable thing to debug.
 *
 * NOTE: `targets/widget/SharedModel.swift` hardcodes the same string, because
 * Swift cannot read this file. Change all three together.
 */
const BUNDLE_ID = 'com.alexivanov.atlantica';
const APP_GROUP = `group.${BUNDLE_ID}`;

/**
 * Apple Developer Team ID, needed to sign the app and the widget extension.
 *
 * Not a secret -- it is embedded in the provisioning profile of every shipped
 * app and is trivially readable from any .ipa -- so it lives here rather than
 * in an env var, which keeps `expo prebuild` and EAS builds working with no
 * extra setup. Override with APPLE_TEAM_ID if you ever build under a different
 * team.
 */
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || '6924F43338';

/**
 * EAS project id.
 *
 * `eas init` normally writes this into app.json, but it cannot edit a dynamic
 * app.config.ts -- it prints the id and expects you to paste it in. Do that
 * here once; builds fail with "project id not configured" until you do.
 */
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || '';

module.exports = { BUNDLE_ID, APP_GROUP, APPLE_TEAM_ID, EAS_PROJECT_ID };
