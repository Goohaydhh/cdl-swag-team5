import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type ChildSessionInput,
  type CreateChildInput,
  type DeviceTokenInput,
  ErrorCode,
  type UpdateChildInput,
  type UpdateDeviceInput,
  type UpdateFamilyInput,
} from '@swag/protocol';
import type { Principal } from '../auth/principal';
import { ACCESS_TTL_SECONDS } from '../auth/principal';
import { TokensService } from '../auth/tokens.service';
import { ApiError } from '../common/api-error';
import { AuditService } from '../common/audit.service';
import { hashPin, newId, randomToken, safeEqualHex, sha256, verifySecret } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import type { ChildProfile, Device } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export const toChildDto = (c: ChildProfile) => ({
  id: c.id,
  display_name: c.displayName,
  avatar_key: c.avatarKey,
  color: c.color,
  has_pin: c.pinHash !== null,
  sort_order: c.sortOrder,
});

const toDeviceDto = (d: Device & { children?: { childProfileId: string }[] }) => ({
  id: d.id,
  kind: d.kind,
  name: d.name,
  platform_info: d.platformInfo,
  child_ids: d.children?.map((c) => c.childProfileId) ?? [],
  last_seen_at: d.lastSeenAt?.toISOString() ?? null,
  revoked_at: d.revokedAt?.toISOString() ?? null,
  created_at: d.createdAt.toISOString(),
});

@Injectable()
export class FamilyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly realtime: RealtimeService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- family

  async getFamily(principal: Principal) {
    const family = await this.prisma.family.findUniqueOrThrow({
      where: { id: principal.fam },
      include: {
        users: { orderBy: { createdAt: 'asc' } },
        children: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return {
      id: family.id,
      name: family.name,
      status_retention_days: family.statusRetentionDays,
      message_retention_days: family.messageRetentionDays,
      allowlist_version: family.allowlistVersion,
      parents: family.users.map((u) => ({
        id: u.id,
        display_name: u.displayName,
        avatar_key: u.avatarKey,
        is_owner: u.isOwner,
      })),
      children: family.children.map(toChildDto),
    };
  }

  async updateFamily(principal: Principal, input: UpdateFamilyInput) {
    await this.prisma.family.update({
      where: { id: principal.fam },
      data: {
        name: input.name,
        statusRetentionDays: input.status_retention_days,
        messageRetentionDays: input.message_retention_days,
      },
    });
    return this.getFamily(principal);
  }

  // ---------------------------------------------------------------- children (FR-3)

  async createChild(principal: Principal, input: CreateChildInput) {
    const child = await this.prisma.childProfile.create({
      data: {
        id: newId(),
        familyId: principal.fam,
        displayName: input.display_name,
        avatarKey: input.avatar_key,
        color: input.color,
        pinHash: input.pin ? await hashPin(input.pin) : null,
        sortOrder: input.sort_order ?? 0,
      },
    });
    await this.profilesChanged(principal.fam);
    return toChildDto(child);
  }

  async updateChild(principal: Principal, childId: string, input: UpdateChildInput) {
    await this.findChild(principal.fam, childId);
    const child = await this.prisma.childProfile.update({
      where: { id: childId },
      data: {
        displayName: input.display_name,
        avatarKey: input.avatar_key,
        color: input.color,
        sortOrder: input.sort_order,
        ...(input.pin !== undefined ? { pinHash: input.pin ? await hashPin(input.pin) : null } : {}),
      },
    });
    await this.profilesChanged(principal.fam);
    return toChildDto(child);
  }

  async deleteChild(principal: Principal, childId: string) {
    await this.findChild(principal.fam, childId);
    await this.prisma.childProfile.delete({ where: { id: childId } });
    await this.audit.log({
      familyId: principal.fam,
      actorType: 'user',
      actorId: principal.sub,
      action: 'child.deleted',
      meta: { child_id: childId },
    });
    await this.profilesChanged(principal.fam);
  }

  private async findChild(familyId: string, childId: string) {
    const child = await this.prisma.childProfile.findFirst({ where: { id: childId, familyId } });
    if (!child) throw ApiError.notFound('Child');
    return child;
  }

  private profilesChanged(familyId: string) {
    return this.realtime.toFamily(familyId, 'profiles_changed', { version: Date.now() });
  }

  // ---------------------------------------------------------------- devices

  async listDevices(principal: Principal) {
    const devices = await this.prisma.device.findMany({
      where: { familyId: principal.fam, revokedAt: null },
      include: { children: { select: { childProfileId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return devices.map(toDeviceDto);
  }

  async updateDevice(principal: Principal, deviceId: string, input: UpdateDeviceInput) {
    const device = await this.findDevice(principal.fam, deviceId);
    if (input.child_ids && device.kind !== 'child_tablet') {
      throw ApiError.validation('Only tablets have children assigned');
    }
    const childIds = input.child_ids ? [...new Set(input.child_ids)] : undefined;
    if (childIds) {
      const owned = await this.prisma.childProfile.count({
        where: { id: { in: childIds }, familyId: principal.fam },
      });
      if (owned !== childIds.length) throw ApiError.validation('Unknown child in child_ids');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (childIds) {
        await tx.deviceChildProfile.deleteMany({ where: { deviceId } });
        await tx.deviceChildProfile.createMany({
          data: childIds.map((childProfileId) => ({ deviceId, childProfileId })),
        });
      }
      return tx.device.update({
        where: { id: deviceId },
        data: { name: input.name },
        include: { children: { select: { childProfileId: true } } },
      });
    });
    if (childIds) await this.realtime.toDevice(principal.fam, deviceId, 'profiles_changed', { version: Date.now() });
    return toDeviceDto(updated);
  }

  /** Revokes a tablet or phone: its tokens stop working now and its sockets are closed. */
  async revokeDevice(principal: Principal, deviceId: string) {
    await this.findDevice(principal.fam, deviceId);
    await this.prisma.device.update({
      where: { id: deviceId },
      data: { revokedAt: new Date(), credentialHash: null, pushToken: null },
    });
    await this.prisma.userSession.updateMany({
      where: { deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.tokens.markDeviceRevoked(deviceId);
    await this.realtime.toDevice(principal.fam, deviceId, 'device_revoked', { reason: 'parent_revoked' });
    this.realtime.disconnectDevice(deviceId);
    await this.audit.log({
      familyId: principal.fam,
      actorType: 'user',
      actorId: principal.sub,
      action: 'device.revoked',
      meta: { device_id: deviceId },
    });
  }

  private async findDevice(familyId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, familyId, revokedAt: null },
    });
    if (!device) throw ApiError.notFound('Device');
    return device;
  }

  // ---------------------------------------------------------------- tablet self-service

  /** Exchanges the tablet's long-lived credential for an access token, rotating the credential. */
  async issueDeviceToken(input: DeviceTokenInput, ip: string) {
    await this.rateLimit.consume(`device-token-ip:${ip}`, 60, 3600);
    const device = await this.prisma.device.findUnique({ where: { id: input.device_id } });
    if (
      !device ||
      device.kind !== 'child_tablet' ||
      device.revokedAt ||
      !device.credentialHash ||
      !safeEqualHex(device.credentialHash, sha256(input.credential))
    ) {
      throw ApiError.unauthenticated('Unknown or revoked device');
    }

    const credential = `dc_${randomToken()}`;
    const rotated = await this.prisma.device.updateMany({
      where: { id: device.id, credentialHash: device.credentialHash },
      data: { credentialHash: sha256(credential), lastSeenAt: new Date() },
    });
    if (rotated.count === 0) throw ApiError.unauthenticated('Credential was just rotated; retry');

    return {
      access_token: await this.tokens.issueDeviceToken(device),
      expires_in: ACCESS_TTL_SECONDS.device,
      credential,
    };
  }

  /**
   * Everything the tablet shows: its children (for the "who is speaking" chips) with their
   * current status, and the parents with their availability and ringer mode.
   */
  async deviceProfiles(principal: Principal) {
    const device = await this.prisma.device.findFirstOrThrow({
      where: { id: principal.dev, familyId: principal.fam },
      include: {
        family: { include: { users: { orderBy: { createdAt: 'asc' }, include: { presence: true } } } },
        children: { include: { child: { include: { currentStatus: true } } } },
      },
    });
    return {
      family: { id: device.family.id, name: device.family.name },
      device: { id: device.id, name: device.name },
      children: device.children
        .map((c) => c.child)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
        .map((c) => ({
          ...toChildDto(c),
          status: c.currentStatus
            ? { status: c.currentStatus.status, occurred_at: c.currentStatus.occurredAt.toISOString() }
            : null,
        })),
      parents: device.family.users.map((u) => ({
        id: u.id,
        display_name: u.displayName,
        avatar_key: u.avatarKey,
        availability: u.presence?.availability ?? 'available',
        eta_minutes: u.presence?.etaMinutes ?? null,
        ringer: u.presence?.ringer ?? 'unknown',
      })),
    };
  }

  /** A child taps their profile on the tablet (FR-4, section 5.3). */
  async startChildSession(principal: Principal, input: ChildSessionInput) {
    const deviceId = principal.dev!;
    const link = await this.prisma.deviceChildProfile.findUnique({
      where: { deviceId_childProfileId: { deviceId, childProfileId: input.child_id } },
      include: { child: true },
    });
    if (!link || link.child.familyId !== principal.fam) throw ApiError.notFound('Child');

    if (link.child.pinHash) {
      const key = `child-pin:${deviceId}:${input.child_id}`;
      if (!(await this.rateLimit.hit(key, 5, 300))) throw ApiError.rateLimited();
      if (!input.pin || !(await verifySecret(link.child.pinHash, input.pin))) {
        throw new ApiError(HttpStatus.UNAUTHORIZED, ErrorCode.PIN_INVALID, 'Wrong PIN');
      }
      await this.rateLimit.reset(key);
    }

    return {
      access_token: await this.tokens.issueChildToken(link.child, deviceId),
      expires_in: ACCESS_TTL_SECONDS.child,
      child: toChildDto(link.child),
    };
  }
}
