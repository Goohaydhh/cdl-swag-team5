import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import sharp, { type OutputInfo } from 'sharp';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { newId } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_UPLOAD_BYTES = 1024 * 1024; // section 5.5
const MAX_SIDE = 2048;
const SIGNED_URL_SECONDS = 5 * 60;
const ACCEPTED_INPUT = new Set(['png', 'webp']);

/** Drawings and avatars in a private bucket, served through short-lived signed URLs. */
@Injectable()
export class MediaService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
  ) {
    this.bucket = env.S3_BUCKET;
    this.s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }

  /**
   * Re-encodes every upload with sharp: proves it is really an image, strips metadata,
   * caps the size, and normalises to PNG (drawings need sharp lines and transparency).
   */
  async uploadImage(p: Principal, input: Buffer) {
    if (p.scope === 'device') throw ApiError.forbidden('Pick a child profile first');
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
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: data, ContentType: mime }),
    );
    return this.prisma.mediaObject.create({
      data: { id, familyId, storageKey, mime, bytes: data.length, width: width ?? null, height: height ?? null },
    });
  }

  async assertUsable(familyId: string, mediaId: string) {
    const found = await this.prisma.mediaObject.count({ where: { id: mediaId, familyId } });
    if (!found) throw ApiError.validation('Unknown media_id; upload the drawing first');
  }

  async signedUrl(p: Principal, mediaId: string) {
    const media = await this.prisma.mediaObject.findFirst({ where: { id: mediaId, familyId: p.fam } });
    if (!media) throw ApiError.notFound('Media');
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: media.storageKey }),
      { expiresIn: SIGNED_URL_SECONDS },
    );
    return { id: media.id, mime: media.mime, url, expires_in: SIGNED_URL_SECONDS };
  }

  /** Deletes stored objects; used by retention and erasure jobs. */
  async deleteObjects(storageKeys: string[]) {
    for (let i = 0; i < storageKeys.length; i += 1000) {
      const chunk = storageKeys.slice(i, i + 1000);
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  /** Raw bytes of a stored object (data export). */
  async read(storageKey: string): Promise<Buffer> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
}
