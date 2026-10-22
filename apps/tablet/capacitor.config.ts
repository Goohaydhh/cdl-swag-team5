import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.centraledigitallab.swag.tablet',
  appName: 'SWAG',
  webDir: 'dist',
  server: {
    // The app page runs at http://localhost (not https), so images from the PC in http are not blocked.
    // Back to https once the API is only reached in https (OVH / school server).
    androidScheme: 'http',
    // Lets the app reach an API in plain http (a PC on the Wi-Fi: http://192.168.x.x:3100).
    // Remove once the API is only reached in https (OVH / school server).
    cleartext: true,
  },
  android: {
    // The restricted browser lives in a native SafeBrowser plugin (Sprint 4), not in this WebView.
    // Kept as a safety net while the API is reached in plain http (see server above).
    allowMixedContent: true,
    webContentsDebuggingEnabled: true, // turn off for release builds
  },
};

export default config;
