import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { AddAllowedUrlInput } from '@swag/protocol';
import type { Response } from 'express';
import { CurrentPrincipal, Scopes } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { AllowlistService } from './allowlist.service';
import { SitesEnabledGuard } from './sites-enabled.guard';

/** Paused for now (product decision): every route answers 404 unless FEATURE_SITES=true. */
@UseGuards(SitesEnabledGuard)
@Controller()
export class AllowlistController {
  constructor(private readonly allowlist: AllowlistService) {}

  @Get('allowed-urls')
  list(@CurrentPrincipal() p: Principal) {
    return this.allowlist.list(p);
  }

  @Post('allowed-urls')
  add(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(AddAllowedUrlInput)) body: AddAllowedUrlInput) {
    return this.allowlist.add(p, body);
  }

  @Delete('allowed-urls/:id')
  @HttpCode(204)
  async remove(@CurrentPrincipal() p: Principal, @Param('id', UuidParam) id: string) {
    await this.allowlist.remove(p, id);
  }

  /** The tablet caches this list offline; it sends the version back as If-None-Match. */
  @Scopes('device', 'child')
  @Get('device/allowed-urls')
  async forDevice(
    @CurrentPrincipal() p: Principal,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const list = await this.allowlist.forDevice(p);
    // The version is family-wide, so scope the ETag to the caller's view of the list.
    const etag = `"${list.version}-${p.scope}-${p.scope === 'child' ? p.sub : p.dev}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return list;
  }
}
