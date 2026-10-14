const { existsSync } = require('node:fs');
const path = require('node:path');

// Push notifications need the Firebase file for the Android build (see SETUP.md, "Notifications").
// Without it the app still builds; it just never gets a push token.
const googleServicesFile = './google-services.json';
const hasFirebase = existsSync(path.join(__dirname, googleServicesFile));

/** Extends app.json. */
module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), ['expo-notifications', { color: '#6B4EFF' }]],
  android: {
    ...config.android,
    ...(hasFirebase ? { googleServicesFile } : {}),
  },
});
