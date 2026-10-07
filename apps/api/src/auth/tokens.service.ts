import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { ApiError } from '../common/api-error';
import { newId, randomToken, sha256 } from '../common/crypto';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { KeysService } from './keys.service';
import { ACCESS_TTL_SECONDS, type Principal, REFRESH_TTL_DAYS } from './principal';

export interface ParentTokens {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

/** Seconds a revoked-device marker is kept: longer than any access token lives. */
const REVOKED_MARKER_TTL = 60 * 60;
const revokedKey = (deviceId: string) => `revoked-device:${deviceId}`;

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: KeysService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async issueParentTokens(
    user: { id: string; familyId: string },
    deviceId?: string,
    tokenFamily: string = newId(),
  ): Promise<ParentTokens> {
    const refreshToken = `rt_${randomToken()}`;
    await this.prisma.userSession.create({
      data: {
        id: newId(),
        userId: user.id,
        deviceId: deviceId ?? null,
        tokenHash: sha256(refreshToken),
        tokenFamily,
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    const access = await this.keys.sign(
      { sub: user.id, fam: user.familyId, scope: 'parent', ...(deviceId ? { dev: deviceId } : {}) },
      ACCESS_TTL_SECONDS.parent,
    );
    return { access_token: access, expires_in: ACCESS_TTL_SECONDS.parent, refresh_token: refreshToken };
  }

  /**
   * Rotates a parent refresh token. Presenting an already-rotated token is treated as theft:
   * the whole rotation chain is revoked (section 5.1).
   */
  async rotateRefreshToken(refreshToken: string): Promise<ParentTokens> {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true, device: true },
    });
    if (!session) throw ApiError.unauthenticated('Invalid refresh token');

    // Atomically claim this token; a second use finds it already revoked.
    const claimed = await this.prisma.userSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeTokenFamily(session.tokenFamily);
      await this.audit.log({
        familyId: session.user.familyId,
        actorType: 'user',
        actorId: session.userId,
        action: 'session.reuse_detected',
      });
      throw ApiError.unauthenticated('Refresh token already used; please sign in again');
    }
    if (session.expiresAt < new Date()) throw ApiError.unauthenticated('Refresh token expired');
    if (session.device?.revokedAt) throw ApiError.unauthenticated('Device was signed out');

    return this.issueParentTokens(session.user, session.deviceId ?? undefined, session.tokenFamily);
  }

  /** Revokes the rotation chain the given refresh token belongs to. Unknown tokens are ignored. */
  async revokeRefreshToken(refreshToken: string, userId: string): Promise<void> {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (session && session.userId === userId) await this.revokeTokenFamily(session.tokenFamily);
  }

  private async revokeTokenFamily(tokenFamily: string) {
    await this.prisma.userSession.updateMany({
      where: { tokenFamily, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  issueDeviceToken(device: { id: string; familyId: string }): Promise<string> {
    return this.keys.sign(
      { sub: device.id, fam: device.familyId, scope: 'device', dev: device.id },
      ACCESS_TTL_SECONDS.device,
    );
  }

  issueChildToken(child: { id: string; familyId: string }, deviceId: string): Promise<string> {
    return this.keys.sign(
      { sub: child.id, fam: child.familyId, scope: 'child', dev: deviceId },
      ACCESS_TTL_SECONDS.child,
    );
  }

  /** Makes every live access token bound to this device fail immediately. */
  async markDeviceRevoked(deviceId: string): Promise<void> {
    await this.redis.client.set(revokedKey(deviceId), '1', { EX: REVOKED_MARKER_TTL });
  }

  async isRevoked(principal: Principal): Promise<boolean> {
    if (!principal.dev) return false;
    return (await this.redis.client.exists(revokedKey(principal.dev))) === 1;
  }
}
