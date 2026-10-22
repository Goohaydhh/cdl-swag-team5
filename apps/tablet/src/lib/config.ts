const SERVER_KEY = 'swag.server';

/** Server address typed on the tablet (pairing screen, "Serveur"). Empty = the built-in default. */
export function savedServer(): string {
  try {
    return localStorage.getItem(SERVER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveServer(url: string) {
  try {
    if (url) localStorage.setItem(SERVER_KEY, url);
    else localStorage.removeItem(SERVER_KEY);
  } catch {
    // Storage unavailable: the default address is used.
  }
}

/** "192.168.1.20:5173" -> "http://192.168.1.20:5173". Returns null when it is not an address. */
export function normalizeServer(input: string): string | null {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return u.origin;
  } catch {
    return null;
  }
}

/** Calls the API health check: 'ok', 'degraded' (API up, database or Redis down) or 'down'. */
export async function testServer(url: string): Promise<'ok' | 'degraded' | 'down'> {
  try {
    const res = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(6000) });
    // A Vite page answering instead of the API would not be JSON with a status.
    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    if (!body?.status) return 'down';
    return body.status === 'ok' ? 'ok' : 'degraded';
  } catch {
    return 'down';
  }
}

/**
 * Base URL of the SWAG API. In development (`pnpm dev`) the Vite server proxies the API, so the
 * page's own address is used: localhost, the PC's LAN IP or an ngrok link all work unchanged.
 * The installed app (APK) uses the address saved on the tablet (pairing screen, "Serveur"),
 * e.g. the PC's Vite gateway http://192.168.1.20:5173, or VITE_API_URL given at build time.
 */
export const API_URL: string =
  savedServer() || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? window.location.origin : 'http://localhost:3100');

/** True when the API is reached through the Vite gateway (see vite.config.ts). */
export const VIA_GATEWAY = API_URL === window.location.origin;

/**
 * Signed media links point at the storage server (localhost:9000 locally). Through the gateway,
 * they are rewritten to /s3/... so they also load from a phone, a tablet or an ngrok link.
 */
export function publicMediaUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      // "localhost" would be the tablet itself. Go through the gateway's /s3 route instead: the
      // page's own address in the browser, or the saved server address in the installed app (APK),
      // which must then be the Vite gateway (port 5173 or an ngrok link), not the API port 3100.
      // (Changing the host directly would break the link's signature.)
      const base = VIA_GATEWAY ? window.location.origin : API_URL;
      return `${base}/s3${u.pathname}${u.search}`;
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
