import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ParentAvailabilityInput, RingerStatusInput, StatusUpdateInput } from '@swag/protocol';
import { z } from 'zod';
import { CurrentPrincipal, Scopes } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { PresenceService } from './presence.service';
import { StatusService } from './status.service';

const HistoryQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** REST fallbacks of the socket events, plus reads (section 6.1). */
@Controller()
export class StatusController {
  constructor(
    private readonly status: StatusService,
    private readonly presence: PresenceService,
  ) {}

  @Scopes('child')
  @Post('children/:id/status')
  @HttpCode(200)
  async postStatus(
    @CurrentPrincipal() p: Principal,
    @Param('id', UuidParam) childId: string,
    @Body(new ZodPipe(StatusUpdateInput.omit({ child_id: true }))) body: Omit<StatusUpdateInput, 'child_id'>,
  ) {
    const { event, duplicate } = await this.status.record(p, { ...body, child_id: childId });
    return { event_id: event.id, duplicate };
  }

  @Get('family/overview')
  overview(@CurrentPrincipal() p: Principal) {
    return this.status.overview(p);
  }

  @Get('children/:id/status-history')
  history(
    @CurrentPrincipal() p: Principal,
    @Param('id', UuidParam) childId: string,
    @Query(new ZodPipe(HistoryQuery)) q: z.infer<typeof HistoryQuery>,
  ) {
    return this.status.history(p, childId, q.cursor, q.limit);
  }

  @Put('me/availability')
  availability(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(ParentAvailabilityInput)) body: ParentAvailabilityInput,
  ) {
    return this.presence.setAvailability(p, body);
  }

  @Put('me/ringer')
  ringer(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(RingerStatusInput)) body: RingerStatusInput) {
    return this.presence.setRinger(p, body);
  }
}
