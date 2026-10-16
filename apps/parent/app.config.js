const { existsSync } = require('node:fs');
const path = require('node:path');
const { withAndroidManifest } = require('expo/config-plugins');

// Lets the release APK reach the API over plain http (a PC on the Wi-Fi, e.g. http://192.168.x.x:5173).
// Remove once the API is only reached in https (OVH / school server).
const withCleartextTraffic = (cfg) =>
  withAndroidManifest(cfg, (c) => {
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return c;
  });

// Push notifications need the Firebase file for the Android build (see SETUP.md, "Notifications").
// Without it the app still builds; it just never gets a push token.
const googleServicesFile = './google-services.json';
const hasFirebase = existsSync(path.join(__dirname, googleServicesFile));

/** Extends app.json. */
module.exports = ({ config }) => withCleartextTraffic({
  ...config,
  plugins: [...(config.plugins ?? []), ['expo-notifications', { color: '#6B4EFF' }]],
  android: {
    ...config.android,
    ...(hasFirebase ? { googleServicesFile } : {}),
  },
});
