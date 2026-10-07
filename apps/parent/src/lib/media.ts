import { useEffect, useState } from 'react';
import { API_URL } from './config';
import { api } from './session';

/**
 * Signed media links point at the storage server (localhost:9000 on the dev PC). When the app
 * talks to the API through the tablet's Vite gateway (LAN IP or ngrok link), load them via /s3.
 */
function publicMediaUrl(url: string): string {
  try {
    const u = new URL(url);
    const apiUrl = new URL(API_URL);
    const local = ['localhost', '127.0.0.1', '10.0.2.2'];
    if (local.includes(u.hostname) && !local.includes(apiUrl.hostname) && apiUrl.port !== '3100') {
      return `${apiUrl.origin}/s3${u.pathname}${u.search}`;
    }
  } catch {
    // not an absolute URL: use as is
  }
  return url;
}

// Drawings and GIFs live in a private bucket behind 5-minute signed URLs.
const cache = new Map<string, { url: string; until: number }>();

export function useMediaUrl(mediaId: string | undefined): string | null {
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!mediaId) return;
    const hit = cache.get(mediaId);
    if (hit && hit.until > Date.now()) return;
    let alive = true;
    api
      .media(mediaId)
      .then((m) => {
        const url = publicMediaUrl(m.url);
        cache.set(mediaId, { url, until: Date.now() + (m.expires_in - 30) * 1000 });
        if (alive) setLoaded({ id: mediaId, url });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mediaId]);
  if (!mediaId) return null;
  return loaded?.id === mediaId ? loaded.url : (cache.get(mediaId)?.url ?? null);
}
