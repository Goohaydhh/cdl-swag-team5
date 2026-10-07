import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type AcceptInviteInput,
  type ApprovePairingInput,
  type DeviceInfo,
  ErrorCode,
} from '@swag/protocol';
import { AuthService } from '../auth/auth.service';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { AuditService } from '../common/audit.service';
import {
  formatPairingCode,
  generatePairingCode,
  hashPassword,
  hmacSha256,
  newId,
  normalizePairingCode,
  randomToken,
  safeEqualHex,
  sha256,
} from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import { RedisService } from '../common/redis.service';
import { ENV, type Env } from '../config/env';
import type { PairingKind, PairingSession } from '../generated/prisma/client';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

const PAIRING_TTL_MS = 5 * 60_000;
const INVITE_TTL_MS = 24 * 60 * 60_000;
const MAX_FAILED_CLAIMS = 5;
const MAX_POLL_SECONDS = 25;
const credentialKey = (pairingId: string) => `pairing:cred:${pairingId}`;

const pairingError = (status: HttpStatus, code: ErrorCode, message: string) =>
  new ApiError(status, code, message);
const notFound = () =>
  pairingError(HttpStatus.NOT_FOUND, ErrorCode.PAIRING_NOT_FOUND, 'Code not found or already used');
const expired = () => pairingError(HttpStatus.GONE, ErrorCode.PAIRING_EXPIRED, 'This code has expired');

export type PollResult =
  | { state: 'pending' | 'claimed' | 'rejected' | 'expired' | 'consumed' }
  | {
      state: 'approved';
      device_id: string;
      credential: string;
      family: { id: string; name: string };
    };

/** Tablet pairing (FR-1/FR-2) and parent invites (FR-3), section 5.2. */
@Injectable()
export class PairingService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly push: PushService,
  ) {}

  // ---------------------------------------------------------------- tablet side

  /** Step 1: an unpaired tablet asks for a code to display. */
  async createSession(deviceInfo: DeviceInfo, ip: string) {
    await this.rateLimit.consume(`pair-create-ip:${ip}`, 20, 3600);
    const pollSecret = randomToken(16);
    const { session, code } = await this.insertWithFreshCode('tablet_pairing', PAIRING_TTL_MS, {
      secretHash: sha256(pollSecret),
      deviceInfo,
    });
    return {
      pairing_id: session.id,
      code: formatPairingCode(code),
      qr_payload: `swag://pair?p=${session.id}&c=${code}`,
      poll_secret: pollSecret,
      expires_at: session.expiresAt.toISOString(),
    };
  }

  /**
   * Step 2: the tablet long-polls with its secret. The device credential is handed out
   * exactly once, then the session is consumed.
   */
  async poll(pairingId: string, pollSecret: string, waitSeconds: number, ip: string): Promise<PollResult> {
    await this.rateLimit.consume(`pair-poll-ip:${ip}`, 600, 3600);
    const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), MAX_POLL_SECONDS) * 1000;
    for (;;) {
      const session = await this.prisma.pairingSession.findUnique({ where: { id: pairingId } });
      if (
        !session ||
        session.kind !== 'tablet_pairing' ||
        !session.secretHash ||
        !safeEqualHex(session.secretHash, sha256(pollSecret))
      ) {
        throw notFound();
      }

      const result = await this.resolvePollState(session);
      if (result || Date.now() >= deadline) return result ?? { state: session.state as 'pending' };
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  private async resolvePollState(session: PairingSession): Promise<PollResult | null> {
    if (session.state === 'approved') {
      const stored = await this.redis.client.getDel(credentialKey(session.id));
      await this.prisma.pairingSession.update({ where: { id: session.id }, data: { state: 'consumed' } });
      if (!stored) return { state: 'consumed' };
      return { state: 'approved', ...(JSON.parse(stored) as Omit<PollResult & { state: 'approved' }, 'state'>) };
    }
    if (session.state === 'rejected' || session.state === 'consumed' || session.state === 'expired') {
      return { state: session.state };
    }
    if (session.expiresAt < new Date()) {
      await this.markExpired(session.id);
      return { state: 'expired' };
    }
    return null; // still pending or claimed: keep waiting
  }

  // ---------------------------------------------------------------- parent side

  /** Step 3: the parent scans the QR or types the code. */
  async claim(principal: Principal, rawCode: string, pairingId: string | undefined, ip: string) {
    await this.rateLimit.consume(`pair-claim-user:${principal.sub}`, 10, 3600);
    await this.rateLimit.consume(`pair-claim-ip:${ip}`, 30, 3600);

    const code = normalizePairingCode(rawCode);
    if (!code) throw ApiError.validation('Codes are 8 characters, like K7QF-9M2D');
    const codeHash = this.hashCode(code);

    let session: PairingSession | null;
    if (pairingId) {
      session = await this.prisma.pairingSession.findUnique({ where: { id: pairingId } });
      if (!session || session.kind !== 'tablet_pairing' || session.state !== 'pending') throw notFound();
      if (session.failedAttempts >= MAX_FAILED_CLAIMS) {
        throw pairingError(HttpStatus.LOCKED, ErrorCode.PAIRING_LOCKED, 'Too many wrong codes; restart pairing');
      }
      if (!safeEqualHex(session.codeHash, codeHash)) {
        const failed = session.failedAttempts + 1;
        await this.prisma.pairingSession.update({
          where: { id: session.id },
          data: { failedAttempts: failed, ...(failed >= MAX_FAILED_CLAIMS ? { state: 'rejected' } : {}) },
        });
        throw notFound();
      }
    } else {
      session = await this.prisma.pairingSession.findFirst({
        where: { codeHash, kind: 'tablet_pairing', state: 'pending' },
      });
      if (!session) throw notFound();
    }

    if (session.expiresAt < new Date()) {
      await this.markExpired(session.id);
      throw expired();
    }

    const claimed = await this.prisma.pairingSession.updateMany({
      where: { id: session.id, state: 'pending' },
      data: { state: 'claimed', familyId: principal.fam, claimedById: principal.sub },
    });
    if (claimed.count === 0) throw notFound();

    await this.audit.log({
      familyId: principal.fam,
      actorType: 'user',
      actorId: principal.sub,
      action: 'pairing.claimed',
      meta: { pairing_id: session.id },
    });
    return {
      pairing_id: session.id,
      device_info: session.deviceInfo as DeviceInfo,
      expires_at: session.expiresAt.toISOString(),
    };
  }

  /** Step 4: the parent confirms the tablet and picks which children appear on it. */
  async approve(principal: Principal, pairingId: string, input: ApprovePairingInput) {
    const session = await this.loadClaimedSession(principal, pairingId);
    const childIds = [...new Set(input.child_ids)];
    const owned = await this.prisma.childProfile.count({
      where: { id: { in: childIds }, familyId: principal.fam },
    });
    if (owned !== childIds.length) throw ApiError.validation('Unknown child in child_ids');

    const credential = `dc_${randomToken()}`;
    const deviceId = newId();
    const family = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.pairingSession.updateMany({
        where: { id: session.id, state: 'claimed' },
        data: { state: 'approved', approvedAt: new Date() },
      });
      if (moved.count === 0) throw notFound();
      await tx.device.create({
        data: {
          id: deviceId,
          familyId: principal.fam,
          kind: 'child_tablet',
          name: input.device_name,
          platformInfo: session.deviceInfo ?? {},
          credentialHash: sha256(credential),
        },
      });
      await tx.deviceChildProfile.createMany({
        data: childIds.map((childProfileId) => ({ deviceId, childProfileId })),
      });
      return tx.family.findUniqueOrThrow({ where: { id: principal.fam } });
    });

    // The credential waits in Redis (never in Postgres) until the tablet's poll picks it up.
    const ttl = Math.max(60, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000));
    await this.redis.client.set(
      credentialKey(session.id),
      JSON.stringify({ device_id: deviceId, credential, family: { id: family.id, name: family.name } }),
      { EX: ttl },
    );

    await this.audit.log({
      familyId: principal.fam,
      actorType: 'user',
      actorId: principal.sub,
      action: 'pairing.approved',
      meta: { pairing_id: session.id, device_id: deviceId },
    });
    // Every parent learns a tablet joined, so a rogue pairing cannot go unnoticed.
    this.push.notifyParents(principal.fam, { type: 'device_paired', device_id: deviceId });
    return { device_id: deviceId, device_name: input.device_name, child_ids: childIds };
  }

  async reject(principal: Principal, pairingId: string) {
    const session = await this.loadClaimedSession(principal, pairingId);
    await this.prisma.pairingSession.update({ where: { id: session.id }, data: { state: 'rejected' } });
    await this.audit.log({
      familyId: principal.fam,
      actorType: 'user',
      actorId: principal.sub,
      action: 'pairing.rejected',
      meta: { pairing_id: session.id },
    });
  }

  private async loadClaimedSession(principal: Principal, pairingId: string) {
    const session = await this.prisma.pairingSession.findUnique({ where: { id: pairingId } });
    if (!session || session.kind !== 'tablet_pairing' || session.familyId !== principal.fam) {
      throw notFound();
    }
    if (session.state !== 'claimed') throw notFound();
    if (session.expiresAt < new Date()) {
      await this.markExpired(session.id);
      throw expired();
    }
    return session;
  }

  // ---------------------------------------------------------------- parent invites (FR-3)

  async createInvite(principal: Principal) {
    await this.rateLimit.consume(`invite-create:${principal.fam}`, 10, 86_400);
    const { session, code } = await this.insertWithFreshCode('parent_invite', INVITE_TTL_MS, {
      familyId: principal.fam,
      createdById: principal.sub,
    });
    await this.audit.log({
      familyId: principal.fam,
      actorType: 'user',
      actorId: principal.sub,
      action: 'invite.created',
      meta: { invite_id: session.id },
    });
    return {
      invite_id: session.id,
      code: formatPairingCode(code),
      qr_payload: `swag://invite?c=${code}`,
      expires_at: session.expiresAt.toISOString(),
    };
  }

  async acceptInvite(input: AcceptInviteInput, ip: string) {
    await this.rateLimit.consume(`invite-accept-ip:${ip}`, 10, 3600);
    const code = normalizePairingCode(input.code);
    if (!code) throw ApiError.validation('Codes are 8 characters, like K7QF-9M2D');

    const invite = await this.prisma.pairingSession.findFirst({
      where: { codeHash: this.hashCode(code), kind: 'parent_invite', state: 'pending' },
    });
    if (!invite?.familyId) throw notFound();
    if (invite.expiresAt < new Date()) {
      await this.markExpired(invite.id);
      throw expired();
    }

    const passwordHash = await hashPassword(input.password);
    const familyId = invite.familyId;
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const used = await tx.pairingSession.updateMany({
          where: { id: invite.id, state: 'pending' },
          data: { state: 'consumed' },
        });
        if (used.count === 0) throw notFound();
        return tx.user.create({
          data: {
            id: newId(),
            familyId,
            email: input.email,
            passwordHash,
            displayName: input.display_name,
            consentAt: new Date(),
          },
        });
      });
      await this.audit.log({
        familyId,
        actorType: 'user',
        actorId: user.id,
        action: 'invite.accepted',
        meta: { invite_id: invite.id },
      });
      return this.auth.signIn(user, input.device);
    } catch (err) {
      if (isUniqueViolation(err)) throw ApiError.conflict('An account already uses this email');
      throw err;
    }
  }

  // ---------------------------------------------------------------- helpers

  private hashCode(code: string) {
    return hmacSha256(this.env.PAIRING_CODE_PEPPER, code);
  }

  private async markExpired(id: string) {
    await this.prisma.pairingSession.updateMany({
      where: { id, state: { in: ['pending', 'claimed'] } },
      data: { state: 'expired' },
    });
  }

  /** Retries on the (astronomically rare) clash with another live session's code. */
  private async insertWithFreshCode(
    kind: PairingKind,
    ttlMs: number,
    extra: { secretHash?: string; deviceInfo?: DeviceInfo; familyId?: string; createdById?: string },
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generatePairingCode();
      try {
        const session = await this.prisma.pairingSession.create({
          data: {
            id: newId(),
            kind,
            codeHash: this.hashCode(code),
            expiresAt: new Date(Date.now() + ttlMs),
            secretHash: extra.secretHash ?? null,
            deviceInfo: extra.deviceInfo ?? {},
            familyId: extra.familyId ?? null,
            createdById: extra.createdById ?? null,
          },
        });
        return { session, code };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new Error('Could not allocate a unique pairing code');
  }
}
