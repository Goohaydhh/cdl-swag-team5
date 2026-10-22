import { useEffect, useState } from 'react';
import { api } from './session';
import { API_URL } from './config';

// Drawings and GIFs are served by the API behind 5-minute signed links.
// The server returns a path like /v1/media/:id/raw?...; make it absolute.
const absolute = (url: string) => new URL(url, API_URL).toString();

const cache = new Map<string, { url: string; until: number }>();
const fresh = (id: string) => {
  const hit = cache.get(id);
  return hit && hit.until > Date.now() ? hit.url : null;
};

export function useMediaUrl(mediaId: string | undefined): string | null {
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!mediaId || fresh(mediaId)) return;
    let alive = true;
    api
      .media(mediaId)
      .then((m) => {
        const url = absolute(m.url);
        cache.set(mediaId, { url, until: Date.now() + (m.expires_in - 30) * 1000 });
        if (alive) setLoaded({ id: mediaId, url });
      })
      .catch((err) => console.warn('[media]', mediaId, err));
    return () => {
      alive = false;
    };
  }, [mediaId]);
  if (!mediaId) return null;
  return loaded?.id === mediaId ? loaded.url : (cache.get(mediaId)?.url ?? null);
}
