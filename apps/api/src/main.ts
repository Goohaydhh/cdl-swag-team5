import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const adapter = new RedisIoAdapter(app);
    await adapter.connect(redisUrl);
    app.useWebSocketAdapter(adapter);
  }

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  Logger.log(`SWAG API listening on http://localhost:${port}/v1`, 'Bootstrap');
}

void bootstrap();
