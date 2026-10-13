import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@swag/protocol';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { hmacSha256, safeEqualHex } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import { RedisService } from '../common/redis.service';
import { ENV, type Env } from '../config/env';
import { MediaService } from './media.service';

/** What we keep about a Giphy item. URLs come from Giphy's API, never from clients. */
interface GifMeta {
  id: string;
  title: string;
  rating: string;
  preview_url: string;
  send_url: string;
  width: number;
  height: number;
}

interface GiphyImage {
  url?: string;
  width?: string;
  height?: string;
  size?: string;
}
interface GiphyItem {
  id: string;
  title?: string;
  rating?: string;
  images?: Record<string, GiphyImage | undefined>;
}

const GIF_ID = /^[A-Za-z0-9]{1,64}$/;
const MAX_GIF_BYTES = 2 * 1024 * 1024;
const META_TTL_SECONDS = 24 * 3600;
const PREVIEW_LINK_SECONDS = 15 * 60;
const metaKey = (id: string) => `gif:${id}`;

/**
 * Giphy behind the backend (section 5.5): the API key stays server-side, every search is
 * rating "g", previews are proxied and sent GIFs are copied into our storage, so the child's
 * IP and device never reach Giphy.
 */
@Injectable()
export class GifsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
    private readonly rateLimit: RateLimitService,
    private readonly media: MediaService,
  ) {}

  async search(p: Principal, q: string, offset: number) {
    const apiKey = this.requireKey();
    await this.rateLimit.consume(`gif-search:${p.sub}`, 30, 60);
    const params = new URLSearchParams({ api_key: apiKey, q, offset: String(offset), limit: '24', rating: 'g', lang: 'fr' });
    const body = await this.giphy<{ data: GiphyItem[] }>(`/v1/gifs/search?${params}`);

    const items = body.data.map(toMeta).filter((m): m is GifMeta => m !== null && m.rating === 'g');
    if (items.length) {
      const multi = this.redis.client.multi();
      for (const m of items) multi.set(metaKey(m.id), JSON.stringify(m), { EX: META_TTL_SECONDS });
      await multi.exec();
    }
    const expires = Math.floor(Date.now() / 1000) + PREVIEW_LINK_SECONDS;
    return {
      items: items.map((m) => ({
        gif_ref: m.id,
        title: m.title,
        width: m.width,
        height: m.height,
        // A signed link to our own proxy, so an <img> tag works without an auth header.
        preview_path: `/v1/gifs/${m.id}/preview?exp=${expires}&sig=${this.sign(m.id, expires)}`,
      })),
      next_offset: body.data.length === 24 ? offset + 24 : null,
      attribution: 'Powered by GIPHY',
    };
  }

  /** Streams a preview through the backend after checking the signed link. */
  async preview(gifId: string, exp: number, sig: string): Promise<{ data: Buffer; mime: string }> {
    if (!GIF_ID.test(gifId) || exp < Date.now() / 1000 || !safeEqualHex(this.sign(gifId, exp), sig)) {
      throw ApiError.notFound('GIF');
    }
    const meta = await this.meta(gifId);
    if (meta.rating !== 'g') throw ApiError.notFound('GIF');
    return { data: await this.download(meta.preview_url), mime: 'image/gif' };
  }

  /** Copies the chosen GIF into the family's storage and returns the media id for the message. */
  async importForMessage(familyId: string, gifRef: string): Promise<string> {
    if (!GIF_ID.test(gifRef)) throw ApiError.validation('Invalid gif_ref');
    const meta = await this.meta(gifRef);
    if (meta.rating !== 'g') throw ApiError.validation('This GIF is not available');
    const data = await this.download(meta.send_url);
    const stored = await this.media.store(familyId, data, 'image/gif', meta.width, meta.height);
    return stored.id;
  }

  private async meta(gifId: string): Promise<GifMeta> {
    const cached = await this.redis.client.get(metaKey(gifId));
    if (cached) return JSON.parse(cached) as GifMeta;
    const apiKey = this.requireKey();
    const body = await this.giphy<{ data: GiphyItem }>(`/v1/gifs/${gifId}?${new URLSearchParams({ api_key: apiKey })}`);
    const meta = toMeta(body.data);
    if (!meta) throw ApiError.notFound('GIF');
    await this.redis.client.set(metaKey(gifId), JSON.stringify(meta), { EX: META_TTL_SECONDS });
    return meta;
  }

  private async giphy<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.env.GIPHY_API_BASE), { signal: AbortSignal.timeout(5000) });
    } catch {
      throw unavailable();
    }
    if (res.status === 404) throw ApiError.notFound('GIF');
    if (!res.ok) throw unavailable();
    return (await res.json()) as T;
  }

  /** SSRF guard: only Giphy media hosts, https in production, size-capped. */
  private async download(url: string): Promise<Buffer> {
    const target = new URL(url);
    const suffix = this.env.GIPHY_MEDIA_HOST_SUFFIX;
    const hostOk = target.hostname === suffix.replace(/^\./, '') || target.hostname.endsWith(suffix);
    const schemeOk = target.protocol === 'https:' || this.env.NODE_ENV !== 'production';
    if (!hostOk || !schemeOk) throw ApiError.validation('Unexpected GIF host');

    let res: Response;
    try {
      res = await fetch(target, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    } catch {
      throw unavailable();
    }
    if (!res.ok) throw unavailable();
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_GIF_BYTES) throw ApiError.validation('GIF is too large');
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_GIF_BYTES) throw ApiError.validation('GIF is too large');
    return data;
  }

  private sign(gifId: string, exp: number) {
    return hmacSha256(this.env.PAIRING_CODE_PEPPER, `gif-preview:${gifId}:${exp}`);
  }

  private requireKey(): string {
    if (!this.env.GIPHY_API_KEY) throw unavailable('GIF search is not configured');
    return this.env.GIPHY_API_KEY;
  }
}

const unavailable = (message = 'GIF service unavailable, try again') =>
  new ApiError(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.INTERNAL, message);

function toMeta(item: GiphyItem | undefined): GifMeta | null {
  const images = item?.images ?? {};
  const preview = images.fixed_width_small ?? images.preview_gif ?? images.fixed_width;
  // fixed_height is ~200 px tall: big enough for a tablet bubble, usually well under 2 MB.
  const send = images.fixed_height ?? images.fixed_height_small ?? images.downsized;
  if (!item?.id || !preview?.url || !send?.url) return null;
  return {
    id: item.id,
    title: item.title ?? '',
    rating: (item.rating ?? '').toLowerCase(),
    preview_url: preview.url,
    send_url: send.url,
    width: Number(send.width ?? 0),
    height: Number(send.height ?? 0),
  };
}
