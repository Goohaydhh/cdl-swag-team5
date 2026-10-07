import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { FcmClient, type ServiceAccount } from './fcm.client';

/**
 * Data-only pushes carry IDs, never names or text (GDPR, section 5.6): the app wakes up
 * and fetches details over the authenticated API.
 */
export type PushData =
  | { type: 'status_updated'; event_id: string; child_id: string }
  | { type: 'device_paired'; device_id: string }
  | { type: 'chat_message'; message_id: string; conversation_id: string }
  | { type: 'url_access_request'; child_id: string };

export interface SentPush {
  deviceId: string;
  data: Record<string, string>;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private fcm: FcmClient | undefined;
  /** Without FCM credentials (local dev, tests) pushes are recorded here instead of sent. */
  readonly recorded: SentPush[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (!this.env.FCM_SERVICE_ACCOUNT_PATH) {
      if (this.env.NODE_ENV === 'production') this.logger.warn('FCM is not configured: pushes are disabled');
      return;
    }
    const account = JSON.parse(readFileSync(this.env.FCM_SERVICE_ACCOUNT_PATH, 'utf8')) as ServiceAccount;
    this.fcm = new FcmClient(account);
  }

  async registerToken(principal: Principal, pushToken: string | null) {
    if (!principal.dev) throw ApiError.validation('Sign in with a device to receive notifications');
    await this.prisma.device.updateMany({
      where: { id: principal.dev, familyId: principal.fam, kind: 'parent_phone', revokedAt: null },
      data: { pushToken },
    });
  }

  /** Fire-and-forget: a push failure must never fail the request that triggered it. */
  notifyParents(familyId: string, data: PushData, exceptDeviceId?: string): void {
    void this.sendToParents(familyId, data, exceptDeviceId).catch((err: Error) =>
      this.logger.error(`push failed: ${err.message}`),
    );
  }

  async sendToParents(familyId: string, data: PushData, exceptDeviceId?: string) {
    const phones = await this.prisma.device.findMany({
      where: {
        familyId,
        kind: 'parent_phone',
        revokedAt: null,
        pushToken: { not: null },
        ...(exceptDeviceId ? { id: { not: exceptDeviceId } } : {}),
      },
      select: { id: true, pushToken: true },
    });
    const payload = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

    await Promise.all(
      phones.map(async (phone) => {
        if (!this.fcm) {
          this.recorded.push({ deviceId: phone.id, data: payload });
          if (this.recorded.length > 500) this.recorded.shift();
          return;
        }
        const result = await this.fcm.send(phone.pushToken!, payload);
        if (result === 'invalid_token') {
          await this.prisma.device.update({ where: { id: phone.id }, data: { pushToken: null } });
        }
      }),
    );
  }
}
