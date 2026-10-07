import { useEffect, useState } from 'react';
import { publicMediaUrl } from './config';
import { api } from './session';

// Drawings and GIFs live in a private bucket behind 5-minute signed URLs.
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
