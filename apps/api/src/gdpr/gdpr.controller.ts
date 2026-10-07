import { Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { UuidParam } from '../common/zod.pipe';
import { GdprService } from './gdpr.service';

@Controller()
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  /** Owner only: ZIP with data.json and the family's images. */
  @Get('me/export')
  async export(@CurrentPrincipal() p: Principal, @Res() res: Response) {
    const { filename, zip } = await this.gdpr.exportFamily(p);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(zip));
  }

  /** Owner only: erases the whole family after a 7-day undo window. */
  @Delete('family')
  @HttpCode(202)
  erase(@CurrentPrincipal() p: Principal) {
    return this.gdpr.requestErasure(p);
  }

  @Post('family/erasure/cancel')
  @HttpCode(204)
  async cancel(@CurrentPrincipal() p: Principal) {
    await this.gdpr.cancelErasure(p);
  }

  /** The owner removes a parent, or any parent removes themself (leaves the family). */
  @Delete('family/members/:userId')
  @HttpCode(204)
  async removeParent(@CurrentPrincipal() p: Principal, @Param('userId', UuidParam) userId: string) {
    await this.gdpr.removeParent(p, userId);
  }
}
