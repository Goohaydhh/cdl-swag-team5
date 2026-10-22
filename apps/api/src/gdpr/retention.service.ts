import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RedisService } from '../common/redis.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { ERASURE_GRACE_DAYS, GdprService } from './gdpr.service';

const DAY_MS = 86_400_000;
const LOCK_KEY = 'lock:retention';

export interface RetentionReport {
  status_events: number;
  messages: number;
  media: number;
  pairing_sessions: number;
  devices: number;
  user_sessions: number;
  audit_log: number;
  families_erased: number;
}

/** Storage limitation (section 5.6): nightly deletion of what families no longer need. */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly media: MediaService,
    private readonly gdpr: GdprService,
  ) {}

  /** 03:15 Paris time. A Redis lock makes sure one API instance runs it. */
  @Cron('15 3 * * *', { timeZone: 'Europe/Paris' })
  async nightly() {
    const locked = await this.redis.client.set(LOCK_KEY, '1', { NX: true, EX: 3600 });
    if (!locked) return;
    try {
      const report = await this.run();
      this.logger.log(`retention: ${JSON.stringify(report)}`);
    } catch (err) {
      this.logger.error(`retention failed: ${(err as Error).stack}`);
    } finally {
      await this.redis.client.del(LOCK_KEY);
    }
  }

  async run(now = new Date()): Promise<RetentionReport> {
    // Each family's own retention setting; the event behind a child's current status is kept.
    const statusEvents = await this.prisma.$executeRaw`
      DELETE FROM status_events se
      USING families f
      WHERE se.family_id = f.id
        AND se.occurred_at < ${now}::timestamptz - make_interval(days => f.status_retention_days)
        AND NOT EXISTS (SELECT 1 FROM child_current_status c WHERE c.event_id = se.id)`;

    const messages = await this.prisma.$executeRaw`
      DELETE FROM messages m
      USING families f
      WHERE m.family_id = f.id
        AND m.created_at < ${now}::timestamptz - make_interval(days => f.message_retention_days)`;

    // Files no message points to any more (expired messages, abandoned uploads older than a day).
    const orphans = await this.prisma.mediaObject.findMany({
      where: { createdAt: { lt: new Date(now.getTime() - DAY_MS) }, messages: { none: {} } },
      select: { id: true, storageKey: true },
    });
    if (orphans.length) {
      await this.media.deleteObjects(orphans.map((o) => o.storageKey));
      await this.prisma.mediaObject.deleteMany({ where: { id: { in: orphans.map((o) => o.id) } } });
    }

    const pairing = await this.prisma.pairingSession.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } },
    });
    const devices = await this.prisma.device.deleteMany({
      where: { revokedAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } },
    });
    const sessions = await this.prisma.userSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } },
        ],
      },
    });
    const audit = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 365 * DAY_MS) } },
    });

    const due = await this.prisma.family.findMany({
      where: { erasureRequestedAt: { lt: new Date(now.getTime() - ERASURE_GRACE_DAYS * DAY_MS) } },
      select: { id: true },
    });
    for (const f of due) await this.gdpr.eraseFamilyNow(f.id);

    return {
      status_events: statusEvents,
      messages,
      media: orphans.length,
      pairing_sessions: pairing.count,
      devices: devices.count,
      user_sessions: sessions.count,
      audit_log: audit.count,
      families_erased: due.length,
    };
  }
}
