import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type AcceptInviteInput,
  type ApprovePairingInput,
  type CreatePairingSessionInput,
  type DeviceInfo,
  ErrorCode,
  type JoinPairingInput,
  type PairingState,
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
import type { PairingKind, PairingSession, Prisma } from '../generated/prisma/client';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Long enough for a parent to fetch the tablet and scan the QR code. */
const PAIRING_TTL_MS = 10 * 60_000;
const INVITE_TTL_MS = 24 * 60 * 60_000;
const MAX_FAILED_CLAIMS = 5;
const MAX_POLL_SECONDS = 25;
const credentialKey = (pairingId: string) => `pairing:cred:${pairingId}`;

const pairingError = (status: HttpStatus, code: ErrorCode, message: string) =>
  new ApiError(status, code, message);
const notFound = () =>
  pairingError(HttpStatus.NOT_FOUND, ErrorCode.PAIRING_NOT_FOUND, 'Code not found or already used');
const expired = () => pairingError(HttpStatus.GONE, ErrorCode.PAIRING_EXPIRED, 'This code has expired');

/** Device info as shown to parents, without our own bookkeeping keys. */
function publicDeviceInfo(info: unknown): Record<string, unknown> {
  const { preselected_child_ids: _ignored, ...rest } = (info ?? {}) as Record<string, unknown>;
  return rest;
}

export type PollResult =
  | { state: 'claimed' | 'rejected' | 'expired' | 'consumed' }
  | {
      state: 'approved';
      device_id: string;
      credential: string;
      family: { id: string; name: string };
    };

/**
 * Tablet pairing (FR-1/FR-2) and parent invites (FR-3), section 5.2.
 * The parent generates the code, the tablet joins with it, the parent validates.
 */
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
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------- step 1, parent

  /**
   * Step 1 (Famille > Associer une tablette): the parent generates the QR code and the code
   * that the tablet will scan or type. The session belongs to the parent's family from the start.
   */
  async createSession(principal: Principal, input: CreatePairingSessionInput) {
    await this.rateLimit.consume(`pair-create-user:${principal.sub}`, 20, 3600);
    if (input.child_ids?.length) await this.assertChildren(principal.fam, input.child_ids);
    const { session, code } = await this.insertWithFreshCode('tablet_pairing', PAIRING_TTL_MS, {
      familyId: principal.fam,
      createdById: principal.sub,
      deviceInfo: input.child_ids?.length ? { preselected_child_ids: input.child_ids } : {},
    });
    await this.audit.log({
      familyId: principal.fam,
      actorType: 'user',
      actorId: principal.sub,
      action: 'pairing.created',
      meta: { pairing_id: session.id },
    });
    return {
      pairing_id: session.id,
      code: formatPairingCode(code),
      qr_payload: `swag://pair?p=${session.id}&c=${code}`,
      expires_at: session.expiresAt.toISOString(),
    };
  }

  /**
   * The parent's screen waits for the tablet: long-polls until the session leaves `pending`
   * (the `pairing_updated` socket event carries the same information instantly).
   */
  async parentState(principal: Principal, pairingId: string, waitSeconds: number) {
    const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), MAX_POLL_SECONDS) * 1000;
    for (;;) {
      const session = await this.prisma.pairingSession.findUnique({ where: { id: pairingId } });
      if (!session || session.kind !== 'tablet_pairing' || session.familyId !== principal.fam) throw notFound();
      if (session.state === 'pending' && session.expiresAt < new Date()) await this.markExpired(session.id);
      const state = session.state === 'pending' && session.expiresAt < new Date() ? 'expired' : session.state;
      if (state !== 'pending' || Date.now() >= deadline) {
        return {
          pairing_id: session.id,
          state,
          device_info: publicDeviceInfo(session.deviceInfo),
          expires_at: session.expiresAt.toISOString(),
        };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // ---------------------------------------------------------------- step 2, tablet

  /**
   * Step 2: the tablet scanned the parent's QR (code + pairing_id) or someone typed the code.
   * Returns the secret the tablet uses to wait for the parent's validation.
   */
  async join(input: JoinPairingInput, ip: string) {
    await this.rateLimit.consume(`pair-join-ip:${ip}`, 30, 3600);

    const code = normalizePairingCode(input.code);
    if (!code) throw ApiError.validation('Codes are 8 characters, like K7QF-9M2D');
    const codeHash = this.hashCode(code);

    let session: PairingSession | null;
    if (input.pairing_id) {
      session = await this.prisma.pairingSession.findUnique({ where: { id: input.pairing_id } });
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

    const pollSecret = randomToken(16);
    const deviceInfo = { ...(session.deviceInfo as Record<string, unknown>), ...input.device_info };
    const claimed = await this.prisma.pairingSession.updateMany({
      where: { id: session.id, state: 'pending' },
      data: { state: 'claimed', secretHash: sha256(pollSecret), deviceInfo: deviceInfo as Prisma.InputJsonObject },
    });
    if (claimed.count === 0) throw notFound();

    const family = await this.prisma.family.findUniqueOrThrow({ where: { id: session.familyId! } });
    await this.audit.log({
      familyId: family.id,
      actorType: 'system',
      action: 'pairing.joined',
      meta: { pairing_id: session.id },
    });
    await this.notifyParents(family.id, session.id, 'claimed', deviceInfo);
    return {
      pairing_id: session.id,
      poll_secret: pollSecret,
      family: { name: family.name },
      expires_at: session.expiresAt.toISOString(),
    };
  }

  /**
   * Step 4 (tablet): long-polls with its secret until the parent validates. The device
   * credential is handed out exactly once, then the session is consumed.
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
      if (result || Date.now() >= deadline) return result ?? { state: session.state as 'claimed' };
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
    return null; // still claimed: keep waiting for the parent
  }

  // ---------------------------------------------------------------- step 3, parent

  /** Step 3 ("Valider la tablette"): the parent confirms and picks which children appear on it. */
  async approve(principal: Principal, pairingId: string, input: ApprovePairingInput) {
    const session = await this.loadClaimedSession(principal, pairingId);
    let childIds = input.child_ids ? [...new Set(input.child_ids)] : [];
    if (childIds.length) {
      await this.assertChildren(principal.fam, childIds);
    } else {
      const preselected = (session.deviceInfo as { preselected_child_ids?: string[] }).preselected_child_ids;
      const all = await this.prisma.childProfile.findMany({
        where: { familyId: principal.fam, ...(preselected?.length ? { id: { in: preselected } } : {}) },
        select: { id: true },
      });
      childIds = all.map((c) => c.id);
      if (!childIds.length) throw ApiError.validation('Add a child to the family before pairing a tablet');
    }

    const credential = `dc_${randomToken()}`;
    const deviceId = newId();
    const family = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.pairingSession.updateMany({
        where: { id: session.id, state: 'claimed' },
        data: { state: 'approved', approvedAt: new Date(), claimedById: principal.sub },
      });
      if (moved.count === 0) throw notFound();
      await tx.device.create({
        data: {
          id: deviceId,
          familyId: principal.fam,
          kind: 'child_tablet',
          name: input.device_name,
          platformInfo: publicDeviceInfo(session.deviceInfo) as Prisma.InputJsonObject,
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
    await this.notifyParents(principal.fam, session.id, 'approved', session.deviceInfo);
    // Every parent learns a tablet joined, so a rogue pairing cannot go unnoticed.
    this.push.notifyParents(principal.fam, { type: 'device_paired', device_id: deviceId });
    return { device_id: deviceId, device_name: input.device_name, child_ids: childIds };
  }

  /** Refuses a tablet that joined, or cancels a code nobody used yet (the parent closed the screen). */
  async reject(principal: Principal, pairingId: string) {
    const session = await this.loadClaimedSession(principal, pairingId, ['pending', 'claimed']);
    await this.prisma.pairingSession.update({
      where: { id: session.id },
      data: { state: 'rejected', claimedById: principal.sub },
    });
    await this.notifyParents(principal.fam, session.id, 'rejected', session.deviceInfo);
    await this.audit.log({
      familyId: principal.fam,
      actorType: 'user',
      actorId: principal.sub,
      action: 'pairing.rejected',
      meta: { pairing_id: session.id },
    });
  }

  private async loadClaimedSession(
    principal: Principal,
    pairingId: string,
    states: PairingState[] = ['claimed'],
  ) {
    const session = await this.prisma.pairingSession.findUnique({ where: { id: pairingId } });
    if (!session || session.kind !== 'tablet_pairing' || session.familyId !== principal.fam) {
      throw notFound();
    }
    if (!states.includes(session.state)) throw notFound();
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

  private async assertChildren(familyId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const owned = await this.prisma.childProfile.count({ where: { id: { in: unique }, familyId } });
    if (owned !== unique.length) throw ApiError.validation('Unknown child in child_ids');
  }

  /** Live update for the parents' "Associer une tablette" screens (user rooms only, not tablets). */
  private async notifyParents(familyId: string, pairingId: string, state: PairingState, deviceInfo: unknown) {
    const parents = await this.prisma.user.findMany({ where: { familyId }, select: { id: true } });
    for (const parent of parents) {
      await this.realtime.toUser(familyId, parent.id, 'pairing_updated', {
        pairing_id: pairingId,
        state,
        device_info: publicDeviceInfo(deviceInfo),
      });
    }
  }

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
    extra: { secretHash?: string; deviceInfo?: Record<string, unknown>; familyId?: string; createdById?: string },
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
            deviceInfo: (extra.deviceInfo ?? {}) as Prisma.InputJsonObject,
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
