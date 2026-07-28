/**
 * Declares the iOS widget extension target.
 *
 * @bacons/apple-targets generates the Xcode target from this during prebuild,
 * so the extension is reproducible from source and survives `prebuild --clean`
 * -- nothing here is hand-edited in Xcode.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
const { APP_GROUP } = require('../../identifiers.js');

module.exports = {
  type: 'widget',
  name: 'AtlanticaWidget',
  icon: '../../assets/icon.png',
  // Must match the app's entitlement in app.config.ts. This shared container
  // is the only way the extension can see data the app writes -- widgets run
  // in a separate process with no access to the app sandbox.
  entitlements: {
    'com.apple.security.application-groups': [APP_GROUP],
  },
  frameworks: [
    'SwiftUI',
    'WidgetKit',
    // ActivityKit powers the Live Activity, which is itself a widget target.
    'ActivityKit',
  ],
  deploymentTarget: '16.2',
};
