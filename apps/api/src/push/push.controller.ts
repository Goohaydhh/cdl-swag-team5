import { Body, Controller, HttpCode, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { PushService } from './push.service';

const PushTokenInput = z.object({ push_token: z.string().min(1).max(4096).nullable() });

@Controller()
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The parent app registers (or clears, with null) its FCM token for this phone. */
  @Put('devices/me/push-token')
  @HttpCode(204)
  async register(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(PushTokenInput)) body: z.infer<typeof PushTokenInput>,
  ) {
    await this.push.registerToken(p, body.push_token);
  }
}
