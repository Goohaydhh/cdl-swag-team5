import { Injectable } from '@nestjs/common';
import type { StatusUpdateInput } from '@swag/protocol';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { newId } from '../common/crypto';
import type { StatusEvent } from '../generated/prisma/client';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Tablet clocks further ahead than this are not trusted (section 7). */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export interface RecordedStatus {
  event: StatusEvent;
  duplicate: boolean;
}

const toEventDto = (e: StatusEvent) => ({
  event_id: e.id,
  child_id: e.childProfileId,
  status: e.status,
  note: e.note ?? undefined,
  occurred_at: e.occurredAt.toISOString(),
  received_at: e.receivedAt.toISOString(),
});

@Injectable()
export class StatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  /**
   * Records a child's status tap (FR-5/6). Idempotent on (device, client_event_id) so the
   * tablet's offline outbox can replay freely; `child_current_status` only moves forward in time.
   */
  async record(principal: Principal, input: StatusUpdateInput): Promise<RecordedStatus> {
    if (principal.scope !== 'child' || input.child_id !== principal.sub) {
      throw ApiError.forbidden('A child can only set their own status');
    }
    const child = await this.prisma.childProfile.findFirst({
      where: { id: principal.sub, familyId: principal.fam },
    });
    if (!child) throw ApiError.notFound('Child');

    const deviceId = principal.dev ?? null;
    if (deviceId) {
      const existing = await this.prisma.statusEvent.findUnique({
        where: { deviceId_clientEventId: { deviceId, clientEventId: input.client_event_id } },
      });
      if (existing) return { event: existing, duplicate: true };
    }

    const receivedAt = new Date();
    const claimed = new Date(input.occurred_at);
    const occurredAt = claimed.getTime() - receivedAt.getTime() > MAX_CLOCK_SKEW_MS ? receivedAt : claimed;

    let event: StatusEvent;
    try {
      event = await this.prisma.$transaction(async (tx) => {
        const created = await tx.statusEvent.create({
          data: {
            id: newId(),
            familyId: principal.fam,
            childProfileId: child.id,
            deviceId,
            status: input.status,
            note: input.note ?? null,
            clientEventId: input.client_event_id,
            occurredAt,
            receivedAt,
          },
        });
        await tx.$executeRaw`
          INSERT INTO child_current_status (child_profile_id, family_id, status, event_id, occurred_at)
          VALUES (${child.id}::uuid, ${principal.fam}::uuid, ${input.status}::"ChildStatus",
                  ${created.id}::uuid, ${occurredAt})
          ON CONFLICT (child_profile_id) DO UPDATE
            SET status = EXCLUDED.status, event_id = EXCLUDED.event_id, occurred_at = EXCLUDED.occurred_at
            WHERE child_current_status.occurred_at < EXCLUDED.occurred_at`;
        return created;
      });
    } catch (err) {
      // Two replays raced: the other one won, return its event.
      if (deviceId && isUniqueViolation(err)) {
        const existing = await this.prisma.statusEvent.findUniqueOrThrow({
          where: { deviceId_clientEventId: { deviceId, clientEventId: input.client_event_id } },
        });
        return { event: existing, duplicate: true };
      }
      throw err;
    }

    await this.realtime.toFamily(principal.fam, 'status_updated', toEventDto(event));
    this.push.notifyParents(principal.fam, { type: 'status_updated', event_id: event.id, child_id: child.id });
    return { event, duplicate: false };
  }

  /** Children's current status and parents' presence in one call, for the app and widget (FR-8). */
  async overview(principal: Principal) {
    const [children, parents] = await Promise.all([
      this.prisma.childProfile.findMany({
        where: { familyId: principal.fam },
        include: { currentStatus: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.user.findMany({
        where: { familyId: principal.fam },
        include: { presence: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      generated_at: new Date().toISOString(),
      children: children.map((c) => ({
        id: c.id,
        display_name: c.displayName,
        avatar_key: c.avatarKey,
        color: c.color,
        status: c.currentStatus
          ? {
              status: c.currentStatus.status,
              event_id: c.currentStatus.eventId,
              occurred_at: c.currentStatus.occurredAt.toISOString(),
            }
          : null,
      })),
      parents: parents.map((u) => ({
        id: u.id,
        display_name: u.displayName,
        avatar_key: u.avatarKey,
        availability: u.presence?.availability ?? 'available',
        eta_minutes: u.presence?.etaMinutes ?? null,
        availability_at: u.presence?.availabilityAt.toISOString() ?? null,
        ringer: u.presence?.ringer ?? 'unknown',
        ringer_at: u.presence?.ringerAt?.toISOString() ?? null,
      })),
    };
  }

  /** Newest first. The cursor is opaque to clients. */
  async history(principal: Principal, childId: string, cursor: string | undefined, limit: number) {
    const child = await this.prisma.childProfile.findFirst({ where: { id: childId, familyId: principal.fam } });
    if (!child) throw ApiError.notFound('Child');

    const after = cursor ? decodeCursor(cursor) : null;
    const events = await this.prisma.statusEvent.findMany({
      where: {
        childProfileId: childId,
        ...(after
          ? {
              OR: [
                { occurredAt: { lt: after.occurredAt } },
                { occurredAt: after.occurredAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = events.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(toEventDto),
      next_cursor: events.length > limit && last ? encodeCursor(last) : null,
    };
  }
}

const encodeCursor = (e: StatusEvent) =>
  Buffer.from(`${e.occurredAt.toISOString()}|${e.id}`).toString('base64url');

function decodeCursor(cursor: string): { occurredAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const occurredAt = new Date(iso ?? '');
  if (!id || Number.isNaN(occurredAt.getTime())) throw ApiError.validation('Invalid cursor');
  return { occurredAt, id };
}
