import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';
import { ENV, type Env } from '../config/env';

/** Shared Redis connection for rate limits, sequence counters and short-lived secrets. */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: ReturnType<typeof createClient>;

  constructor(@Inject(ENV) env: Env) {
    this.client = createClient({ url: env.REDIS_URL });
    this.client.on('error', (err: Error) => this.logger.error(err.message));
  }

  async onModuleInit() {
    await this.client.connect();
  }

  async onModuleDestroy() {
    if (this.client.isOpen) await this.client.close();
  }
}
