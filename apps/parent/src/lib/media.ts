import { useEffect, useState } from 'react';
import { API_URL } from './config';
import { api } from './session';

/**
 * Turns the media link returned by the API into a link the phone can load:
 * - tablet server: "/v1/media/<id>/raw" (relative, or absolute with the tablet's own host)
 *   -> <server address>/v1/media/<id>/raw
 * - PC dev server: signed S3 link on localhost:9000 -> <server address>/s3/... (via the Vite gateway)
 */
function publicMediaUrl(url: string): string {
  // Relative link from the API (tablet server): "/v1/media/..."
  if (url.startsWith('/')) return api.absolute(url);
  try {
    const u = new URL(url);
    const apiUrl = new URL(API_URL);
    // Absolute link to the API's own media route: keep the path, use the address the phone knows.
    if (u.pathname.startsWith('/v1/media/')) return `${apiUrl.origin}${u.pathname}${u.search}`;
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
