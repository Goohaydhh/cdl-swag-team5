import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.centraledigitallab.swag.tablet',
  appName: 'SWAG',
  webDir: 'dist',
  android: {
    // The restricted browser lives in a native SafeBrowser plugin (Sprint 4), not in this WebView.
    allowMixedContent: false,
    webContentsDebuggingEnabled: true, // turn off for release builds
  },
};

export default config;
