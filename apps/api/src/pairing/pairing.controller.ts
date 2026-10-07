import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  AcceptInviteInput,
  ApprovePairingInput,
  ClaimPairingInput,
  CreatePairingSessionInput,
} from '@swag/protocol';
import { z } from 'zod';
import { ClientIp, CurrentPrincipal, Public } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { PairingService } from './pairing.service';

const WaitQuery = new ZodPipe(z.coerce.number().int().min(0).max(25).default(25));

@Controller()
export class PairingController {
  constructor(private readonly pairing: PairingService) {}

  @Public()
  @Post('pairing/sessions')
  createSession(
    @Body(new ZodPipe(CreatePairingSessionInput)) body: CreatePairingSessionInput,
    @ClientIp() ip: string,
  ) {
    return this.pairing.createSession(body.device_info, ip);
  }

  @Public()
  @Get('pairing/sessions/:id')
  poll(
    @Param('id', UuidParam) id: string,
    @Headers('x-pairing-secret') secret: string | undefined,
    @Query('wait', WaitQuery) wait: number,
    @ClientIp() ip: string,
  ) {
    if (!secret) throw ApiError.unauthenticated('X-Pairing-Secret header required');
    return this.pairing.poll(id, secret, wait, ip);
  }

  @Post('pairing/claim')
  @HttpCode(200)
  claim(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodPipe(ClaimPairingInput)) body: ClaimPairingInput,
    @ClientIp() ip: string,
  ) {
    return this.pairing.claim(principal, body.code, body.pairing_id, ip);
  }

  @Post('pairing/sessions/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(ApprovePairingInput)) body: ApprovePairingInput,
  ) {
    return this.pairing.approve(principal, id, body);
  }

  @Post('pairing/sessions/:id/reject')
  @HttpCode(204)
  async reject(@CurrentPrincipal() principal: Principal, @Param('id', UuidParam) id: string) {
    await this.pairing.reject(principal, id);
  }

  @Post('family/invites')
  createInvite(@CurrentPrincipal() principal: Principal) {
    return this.pairing.createInvite(principal);
  }

  @Public()
  @Post('family/invites/accept')
  acceptInvite(@Body(new ZodPipe(AcceptInviteInput)) body: AcceptInviteInput, @ClientIp() ip: string) {
    return this.pairing.acceptInvite(body, ip);
  }
}
