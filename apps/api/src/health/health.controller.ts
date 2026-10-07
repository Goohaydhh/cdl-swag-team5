import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Readiness: 200 only when PostgreSQL and Redis both answer. Used by the load balancer. */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const, () => 'down' as const),
      this.redis.client.ping().then(() => 'ok' as const, () => 'down' as const),
    ]);
    const ok = db === 'ok' && redis === 'ok';
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', db, redis, time: new Date().toISOString() };
  }
}
