import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp, { type OutputInfo } from 'sharp';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { hmacSha256, newId, safeEqualHex } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_UPLOAD_BYTES = 1024 * 1024; // section 5.5
const MAX_SIDE = 2048;
const SIGNED_URL_SECONDS = 5 * 60;
const ACCEPTED_INPUT = new Set(['png', 'webp']);

/**
 * Drawings and avatars stored on local disk (Termux tablet-as-server test), served by the API
 * itself through short-lived signed links — the same signing used for GIF previews. No S3.
 */
@Injectable()
export class MediaService {
  private readonly baseDir: string;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {
    this.baseDir = process.env.MEDIA_DIR || join(process.env.HOME ?? process.cwd(), 'swag-media');
  }

  /**
   * Re-encodes every upload with sharp: proves it is really an image, strips metadata,
   * caps the size, and normalises to PNG (drawings need sharp lines and transparency).
   */
  async uploadImage(p: Principal, input: Buffer) {
    await this.rateLimit.consume(`upload:${p.sub}`, 30, 3600);
    if (input.length > MAX_UPLOAD_BYTES) throw ApiError.validation('Images are limited to 1 MB');

    let output: { data: Buffer; info: OutputInfo };
    try {
      const image = sharp(input, { limitInputPixels: 4096 * 4096, animated: false });
      const meta = await image.metadata();
      if (!meta.format || !ACCEPTED_INPUT.has(meta.format)) throw new Error('format');
      output = await image
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, palette: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw ApiError.validation('Upload a PNG or WebP image');
    }
    if (output.data.length > MAX_UPLOAD_BYTES) throw ApiError.validation('Image is too large after encoding');

    const media = await this.store(p.fam, output.data, 'image/png', output.info.width, output.info.height);
    return { id: media.id, mime: media.mime, bytes: media.bytes, width: media.width, height: media.height };
  }

  /** Stores bytes the server already trusts (e.g. a GIF fetched from Giphy). */
  async store(familyId: string, data: Buffer, mime: string, width?: number, height?: number) {
    const id = newId();
    const storageKey = `families/${familyId}/media/${id}`;
    const full = join(this.baseDir, storageKey);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return this.prisma.mediaObject.create({
      data: { id, familyId, storageKey, mime, bytes: data.length, width: width ?? null, height: height ?? null },
    });
  }

  async assertUsable(familyId: string, mediaId: string) {
    const found = await this.prisma.mediaObject.count({ where: { id: mediaId, familyId } });
    if (!found) throw ApiError.validation('Unknown media_id; upload the drawing first');
  }

  /** A signed, short-lived link to our own /v1/media/:id/raw route (works in an <img> tag). */
  async signedUrl(p: Principal, mediaId: string) {
    const media = await this.prisma.mediaObject.findFirst({ where: { id: mediaId, familyId: p.fam } });
    if (!media) throw ApiError.notFound('Media');
    const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_SECONDS;
    const url = `/v1/media/${media.id}/raw?exp=${exp}&sig=${this.sign(media.id, exp)}`;
    return { id: media.id, mime: media.mime, url, expires_in: SIGNED_URL_SECONDS };
  }

  /** Streams the file after checking the signed link (used by the public raw route). */
  async readSigned(mediaId: string, exp: number, sig: string): Promise<{ data: Buffer; mime: string }> {
    if (exp < Date.now() / 1000 || !safeEqualHex(this.sign(mediaId, exp), sig)) throw ApiError.notFound('Media');
    const media = await this.prisma.mediaObject.findUnique({ where: { id: mediaId } });
    if (!media) throw ApiError.notFound('Media');
    return { data: await this.read(media.storageKey), mime: media.mime };
  }

  /** Deletes stored objects; used by retention and erasure jobs. */
  async deleteObjects(storageKeys: string[]) {
    for (const key of storageKeys) {
      await rm(join(this.baseDir, key), { force: true });
    }
  }

  /** Raw bytes of a stored object (data export). */
  async read(storageKey: string): Promise<Buffer> {
    return readFile(join(this.baseDir, storageKey));
  }

  private sign(mediaId: string, exp: number) {
    return hmacSha256(this.env.PAIRING_CODE_PEPPER, `media:${mediaId}:${exp}`);
  }
}
