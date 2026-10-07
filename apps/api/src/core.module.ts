import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth/auth.service';
import { KeysService } from './auth/keys.service';
import { TokensService } from './auth/tokens.service';
import { AuditService } from './common/audit.service';
import { RateLimitService } from './common/rate-limit.service';
import { RedisService } from './common/redis.service';
import { ENV, loadEnv } from './config/env';
import { PrismaService } from './prisma/prisma.service';
import { PushService } from './push/push.service';
import { RealtimeService } from './realtime/realtime.service';

const providers = [
  { provide: ENV, useFactory: () => loadEnv() },
  PrismaService,
  RedisService,
  RateLimitService,
  AuditService,
  KeysService,
  TokensService,
  AuthService,
  RealtimeService,
  PushService,
];

/** Shared infrastructure, available to every feature module. */
@Global()
@Module({ providers, exports: providers })
export class CoreModule {}
