import { Injectable } from '@nestjs/common';
import { ApiError } from './api-error';
import { RedisService } from './redis.service';

/** Fixed-window counters in Redis. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Counts one attempt; returns false once `limit` is exceeded within the window. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const redisKey = `rl:${key}`;
    const count = await this.redis.client.incr(redisKey);
    if (count === 1) await this.redis.client.expire(redisKey, windowSeconds);
    return count <= limit;
  }

  /** Counts one attempt and throws RATE_LIMITED (429) once the limit is exceeded. */
  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    if (!(await this.hit(key, limit, windowSeconds))) throw ApiError.rateLimited();
  }

  async reset(key: string): Promise<void> {
    await this.redis.client.del(`rl:${key}`);
  }
}
