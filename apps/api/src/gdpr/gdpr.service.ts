import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@swag/protocol';
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Principal } from '../auth/principal';
import { TokensService } from '../auth/tokens.service';
import { ApiError } from '../common/api-error';
import { AuditService } from '../common/audit.service';
import { RateLimitService } from '../common/rate-limit.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export const ERASURE_GRACE_DAYS = 7;
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Rights of access, portability and erasure (section 5.6). */
@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly tokens: TokensService,
    private readonly realtime: RealtimeService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- export

  /** A ZIP of everything stored about the family: data.json plus the images. Secrets are left out. */
  async exportFamily(p: Principal): Promise<{ filename: string; zip: Uint8Array }> {
    await this.assertOwner(p);
    await this.rateLimit.consume(`export:${p.fam}`, 3, 86_400);
    const fam = p.fam;

    const [family, users, children, devices, statusEvents, presence, conversations, messages, media, allowedUrls, audit] =
      await Promise.all([
        this.prisma.family.findUniqueOrThrow({ where: { id: fam } }),
        this.prisma.user.findMany({ where: { familyId: fam } }),
        this.prisma.childProfile.findMany({ where: { familyId: fam } }),
        this.prisma.device.findMany({ where: { familyId: fam }, include: { children: true } }),
        this.prisma.statusEvent.findMany({ where: { familyId: fam }, orderBy: { occurredAt: 'asc' } }),
        this.prisma.parentPresence.findMany({ where: { familyId: fam } }),
        this.prisma.conversation.findMany({ where: { familyId: fam }, include: { members: true } }),
        this.prisma.message.findMany({ where: { familyId: fam }, orderBy: { id: 'asc' } }),
        this.prisma.mediaObject.findMany({ where: { familyId: fam } }),
        this.prisma.allowedUrl.findMany({ where: { familyId: fam } }),
        this.prisma.auditLog.findMany({ where: { familyId: fam }, orderBy: { createdAt: 'asc' } }),
      ]);

    const data = {
      exported_at: new Date().toISOString(),
      family: {
        id: family.id,
        name: family.name,
        status_retention_days: family.statusRetentionDays,
        message_retention_days: family.messageRetentionDays,
        created_at: family.createdAt,
      },
      parents: users.map((u) => ({
        id: u.id,
        email: u.email,
        display_name: u.displayName,
        is_owner: u.isOwner,
        consent_at: u.consentAt,
        created_at: u.createdAt,
      })),
      children: children.map((c) => ({
        id: c.id,
        display_name: c.displayName,
        avatar_key: c.avatarKey,
        color: c.color,
        has_pin: c.pinHash !== null,
        created_at: c.createdAt,
      })),
      devices: devices.map((d) => ({
        id: d.id,
        kind: d.kind,
        name: d.name,
        platform_info: d.platformInfo,
        child_ids: d.children.map((c) => c.childProfileId),
        last_seen_at: d.lastSeenAt,
        revoked_at: d.revokedAt,
        created_at: d.createdAt,
      })),
      status_events: statusEvents.map((e) => ({
        id: e.id,
        child_id: e.childProfileId,
        status: e.status,
        note: e.note,
        occurred_at: e.occurredAt,
        received_at: e.receivedAt,
      })),
      parent_presence: presence.map((x) => ({
        user_id: x.userId,
        availability: x.availability,
        eta_minutes: x.etaMinutes,
        availability_at: x.availabilityAt,
        ringer: x.ringer,
        ringer_at: x.ringerAt,
      })),
      conversations: conversations.map((c) => ({
        id: c.id,
        is_group: c.isGroup,
        members: c.members.map((m) => ({ type: m.memberType, id: m.memberId, last_read_id: m.lastReadId })),
      })),
      messages: messages.map((m) => ({
        id: m.id,
        conversation_id: m.conversationId,
        sender: { type: m.senderType, id: m.senderId },
        kind: m.kind,
        body: m.body,
        media_file: m.mediaId ? mediaFileName(media.find((x) => x.id === m.mediaId)) : null,
        sticker_code: m.stickerCode,
        gif_ref: m.gifRef,
        created_at: m.createdAt,
      })),
      allowed_urls: allowedUrls.map((u) => ({
        id: u.id,
        match: u.match,
        host: u.host,
        path_prefix: u.pathPrefix,
        title: u.title,
        child_id: u.childProfileId,
        created_at: u.createdAt,
      })),
      security_log: audit.map((a) => ({ action: a.action, actor_type: a.actorType, at: a.createdAt })),
    };

    const files: Zippable = { 'data.json': strToU8(JSON.stringify(data, null, 2)) };
    for (const m of media) {
      try {
        files[`media/${mediaFileName(m)}`] = [new Uint8Array(await this.media.read(m.storageKey)), { level: 0 }];
      } catch (err) {
        this.logger.warn(`export: media ${m.id} unreadable: ${(err as Error).message}`);
      }
    }

    await this.audit.log({ familyId: fam, actorType: 'user', actorId: p.sub, action: 'gdpr.exported' });
    const day = new Date().toISOString().slice(0, 10);
    return { filename: `swag-export-${day}.zip`, zip: zipSync(files) };
  }

  // ---------------------------------------------------------------- erasure

  /** Schedules the whole family for deletion after a 7-day undo window. */
  async requestErasure(p: Principal) {
    await this.assertOwner(p);
    const requestedAt = new Date();
    await this.prisma.family.update({ where: { id: p.fam }, data: { erasureRequestedAt: requestedAt } });
    await this.audit.log({ familyId: p.fam, actorType: 'user', actorId: p.sub, action: 'gdpr.erasure_requested' });
    return { erasure_scheduled_for: new Date(requestedAt.getTime() + ERASURE_GRACE_DAYS * 86_400_000).toISOString() };
  }

  async cancelErasure(p: Principal) {
    await this.assertOwner(p);
    await this.prisma.family.update({ where: { id: p.fam }, data: { erasureRequestedAt: null } });
    await this.audit.log({ familyId: p.fam, actorType: 'user', actorId: p.sub, action: 'gdpr.erasure_cancelled' });
  }

  /** Irreversible: deletes every row (cascade) and every stored file of the family. */
  async eraseFamilyNow(familyId: string) {
    const [media, devices] = await Promise.all([
      this.prisma.mediaObject.findMany({ where: { familyId }, select: { storageKey: true } }),
      this.prisma.device.findMany({ where: { familyId }, select: { id: true } }),
    ]);
    for (const d of devices) await this.tokens.markDeviceRevoked(d.id);
    await this.realtime.toFamily(familyId, 'device_revoked', { reason: 'family_erased' });
    for (const d of devices) this.realtime.disconnectDevice(d.id);

    await this.media.deleteObjects(media.map((m) => m.storageKey));
    await this.prisma.family.delete({ where: { id: familyId } });
    await this.prisma.auditLog.deleteMany({ where: { familyId } });
    // Kept without personal data, as evidence the erasure happened.
    await this.audit.log({ familyId: null, actorType: 'system', action: 'gdpr.family_erased' });
  }

  // ---------------------------------------------------------------- membership

  /** The owner removes another parent, or a parent leaves (removes themself). */
  async removeParent(p: Principal, userId: string) {
    const target = await this.prisma.user.findFirst({ where: { id: userId, familyId: p.fam } });
    if (!target) throw ApiError.notFound('Parent');
    if (target.isOwner) {
      throw new ApiError(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'The owner cannot be removed; erase the family instead');
    }
    if (userId !== p.sub) await this.assertOwner(p);

    const phones = await this.prisma.device.findMany({ where: { ownerUserId: userId }, select: { id: true } });
    for (const d of phones) {
      await this.tokens.markDeviceRevoked(d.id);
      this.realtime.disconnectDevice(d.id);
    }
    await this.prisma.user.delete({ where: { id: userId } }); // cascades sessions, phones, presence
    await this.prisma.conversationMember.deleteMany({ where: { memberType: 'user', memberId: userId } });
    await this.audit.log({
      familyId: p.fam,
      actorType: 'user',
      actorId: p.sub,
      action: userId === p.sub ? 'family.parent_left' : 'family.parent_removed',
    });
    await this.realtime.toFamily(p.fam, 'profiles_changed', { version: Date.now() });
  }

  private async assertOwner(p: Principal) {
    const user = await this.prisma.user.findFirst({ where: { id: p.sub, familyId: p.fam } });
    if (!user?.isOwner) throw ApiError.forbidden('Only the family owner can do this');
  }
}

function mediaFileName(m: { id: string; mime: string } | undefined): string | null {
  return m ? `${m.id}.${MIME_EXT[m.mime] ?? 'bin'}` : null;
}
