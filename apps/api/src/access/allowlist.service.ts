import { HttpStatus, Injectable } from '@nestjs/common';
import { type AddAllowedUrlInput, buildAllowlistRule, ErrorCode, normalizeUrl } from '@swag/protocol';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { newId } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import type { AllowedUrl } from '../generated/prisma/client';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';

const toDto = (u: AllowedUrl) => ({
  id: u.id,
  match: u.match,
  host: u.host,
  path_prefix: u.pathPrefix,
  title: u.title,
  icon_key: u.iconKey,
  child_id: u.childProfileId,
  created_at: u.createdAt.toISOString(),
});

/** Parent-managed website allowlist (FR-9, section 5.4). The tablet enforces it natively. */
@Injectable()
export class AllowlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly rateLimit: RateLimitService,
    private readonly push: PushService,
  ) {}

  async list(p: Principal) {
    const [family, urls] = await Promise.all([
      this.prisma.family.findUniqueOrThrow({ where: { id: p.fam } }),
      this.prisma.allowedUrl.findMany({ where: { familyId: p.fam }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { version: family.allowlistVersion, items: urls.map(toDto) };
  }

  async add(p: Principal, input: AddAllowedUrlInput) {
    const built = buildAllowlistRule(input.url, input.match);
    if (!built.ok) throw ApiError.validation(built.reason);
    if (input.child_id) {
      const owned = await this.prisma.childProfile.count({ where: { id: input.child_id, familyId: p.fam } });
      if (!owned) throw ApiError.validation('Unknown child_id');
    }

    let created: AllowedUrl;
    try {
      created = await this.prisma.allowedUrl.create({
        data: {
          id: newId(),
          familyId: p.fam,
          childProfileId: input.child_id ?? null,
          match: built.rule.match,
          host: built.rule.host,
          pathPrefix: built.rule.path_prefix,
          title: input.title ?? built.rule.host,
          createdById: p.sub,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw ApiError.conflict('This website is already allowed');
      throw err;
    }
    await this.bumpVersion(p.fam);
    return toDto(created);
  }

  async remove(p: Principal, id: string) {
    const removed = await this.prisma.allowedUrl.deleteMany({ where: { id, familyId: p.fam } });
    if (removed.count === 0) throw ApiError.notFound('Allowed website');
    await this.bumpVersion(p.fam);
  }

  /** What a tablet enforces: family-wide rules plus those of its children (or of the active child). */
  async forDevice(p: Principal) {
    const family = await this.prisma.family.findUniqueOrThrow({ where: { id: p.fam } });
    let childIds: string[];
    if (p.scope === 'child') {
      childIds = [p.sub];
    } else {
      const links = await this.prisma.deviceChildProfile.findMany({
        where: { deviceId: p.dev! },
        select: { childProfileId: true },
      });
      childIds = links.map((l) => l.childProfileId);
    }
    const urls = await this.prisma.allowedUrl.findMany({
      where: { familyId: p.fam, OR: [{ childProfileId: null }, { childProfileId: { in: childIds } }] },
      orderBy: { createdAt: 'asc' },
    });
    return { version: family.allowlistVersion, items: urls.map(toDto) };
  }

  /** A child taps "Ask to open" on a blocked page: parents get a live event and a push. */
  async requestAccess(p: Principal, rawUrl: string) {
    if (p.scope !== 'child') throw ApiError.forbidden('Only a child session can ask');
    if (!(await this.rateLimit.hit(`url-request:${p.sub}`, 5, 600))) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED, 'Your parents already got your request');
    }
    const url = normalizeUrl(rawUrl);
    if (!url) throw ApiError.validation('Not a web address');

    const parents = await this.prisma.user.findMany({ where: { familyId: p.fam }, select: { id: true } });
    const data = { child_id: p.sub, url: `https://${url.host}${url.path}`, requested_at: new Date().toISOString() };
    for (const parent of parents) await this.realtime.toUser(p.fam, parent.id, 'url_access_requested', data);
    this.push.notifyParents(p.fam, { type: 'url_access_request', child_id: p.sub });
  }

  private async bumpVersion(familyId: string) {
    const family = await this.prisma.family.update({
      where: { id: familyId },
      data: { allowlistVersion: { increment: 1 } },
    });
    await this.realtime.toFamily(familyId, 'allowed_urls_changed', { version: family.allowlistVersion });
  }
}
