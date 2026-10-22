import { Injectable, Logger } from '@nestjs/common';
import type { ActorType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  familyId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  /** Dotted verb, e.g. `pairing.approved`. */
  action: string;
  /** Never message content or names. */
  meta?: Record<string, string | number | boolean | null>;
}

/** Security event log (pairing, revocation, logins). Failures never break the request. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          familyId: entry.familyId ?? null,
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          action: entry.action,
          meta: entry.meta ?? {},
        },
      });
    } catch (err) {
      this.logger.error(`audit write failed for ${entry.action}: ${(err as Error).message}`);
    }
  }
}
