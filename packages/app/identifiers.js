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

module.exports = { BUNDLE_ID, APP_GROUP };
