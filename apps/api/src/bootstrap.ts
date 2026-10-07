import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ENV, type Env } from './config/env';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

/** Shared by main.ts and the tests so both run the same HTTP and socket setup. */
export async function configureApp(app: INestApplication): Promise<Env> {
  const env = app.get<Env>(ENV);
  const http = app as NestExpressApplication;

  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  // JSON API only: no HTML, so the strictest policy costs nothing.
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } } }));
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: false });
  http.useBodyParser('json', { limit: '100kb' });
  http.disable('x-powered-by');
  if (env.TRUST_PROXY_HOPS > 0) http.set('trust proxy', env.TRUST_PROXY_HOPS);

  const adapter = new RedisIoAdapter(app, env.CORS_ORIGINS);
  await adapter.connect(env.REDIS_URL);
  app.useWebSocketAdapter(adapter);
  return env;
}
