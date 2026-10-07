/**
 * Base URL of the SWAG API. In development (`pnpm dev`) the Vite server proxies the API, so the
 * page's own address is used: localhost, the PC's LAN IP or an ngrok link all work unchanged.
 * The Android build (Capacitor) needs VITE_API_URL, e.g. http://192.168.1.20:3100.
 */
export const API_URL: string =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? window.location.origin : 'http://localhost:3100');

/** True when the API is reached through the Vite gateway (see vite.config.ts). */
export const VIA_GATEWAY = API_URL === window.location.origin;

/**
 * Signed media links point at the storage server (localhost:9000 locally). Through the gateway,
 * they are rewritten to /s3/... so they also load from a phone, a tablet or an ngrok link.
 */
export function publicMediaUrl(url: string): string {
  try {
    const u = new URL(url);
    if (VIA_GATEWAY && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return `${window.location.origin}/s3${u.pathname}${u.search}`;
    }
  } catch {
    // not an absolute URL: use as is
  }
  return url;
}

/** Shown to parents when the tablet joins. */
export function deviceInfo(): Record<string, string> {
  const ua = navigator.userAgent;
  const android = /Android [\d.]+;\s*([^;)]+)/.exec(ua);
  return {
    model: (android?.[1] ?? (/(iPad|Macintosh|Windows|Linux)/.exec(ua)?.[1] ?? 'Tablette')).slice(0, 80),
    app_version: '0.1.0',
  };
}
