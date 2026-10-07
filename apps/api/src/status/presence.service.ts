import { Injectable } from '@nestjs/common';
import type { ParentAvailabilityInput, RingerStatusInput } from '@swag/protocol';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/** Parent availability (FR-7) and phone ringer mode (FR-13). Only the latest value matters. */
@Injectable()
export class PresenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async setAvailability(principal: Principal, input: ParentAvailabilityInput) {
    this.assertParent(principal);
    const now = new Date();
    const etaMinutes = input.status === 'on_my_way' ? (input.eta_minutes ?? null) : null;
    const presence = await this.prisma.parentPresence.upsert({
      where: { userId: principal.sub },
      create: {
        userId: principal.sub,
        familyId: principal.fam,
        availability: input.status,
        etaMinutes,
        availabilityAt: now,
      },
      update: { availability: input.status, etaMinutes, availabilityAt: now },
    });
    await this.realtime.toFamily(principal.fam, 'availability_updated', {
      user_id: principal.sub,
      status: presence.availability,
      ...(presence.etaMinutes !== null ? { eta_minutes: presence.etaMinutes } : {}),
      updated_at: now.toISOString(),
    });
    return { status: presence.availability, eta_minutes: presence.etaMinutes, updated_at: now.toISOString() };
  }

  /** Ignores reports older than the stored one, so a delayed offline replay cannot win. */
  async setRinger(principal: Principal, input: RingerStatusInput) {
    this.assertParent(principal);
    const changedAt = new Date(Math.min(new Date(input.changed_at).getTime(), Date.now()));
    const current = await this.prisma.parentPresence.findUnique({ where: { userId: principal.sub } });
    if (current?.ringerAt && current.ringerAt >= changedAt) {
      return { mode: current.ringer, updated_at: current.ringerAt.toISOString(), applied: false };
    }
    await this.prisma.parentPresence.upsert({
      where: { userId: principal.sub },
      create: { userId: principal.sub, familyId: principal.fam, ringer: input.mode, ringerAt: changedAt },
      update: { ringer: input.mode, ringerAt: changedAt },
    });
    await this.realtime.toFamily(principal.fam, 'ringer_updated', {
      user_id: principal.sub,
      mode: input.mode,
      updated_at: changedAt.toISOString(),
    });
    return { mode: input.mode, updated_at: changedAt.toISOString(), applied: true };
  }

  private assertParent(principal: Principal) {
    if (principal.scope !== 'parent') throw ApiError.forbidden('Only parents have availability');
  }
}
