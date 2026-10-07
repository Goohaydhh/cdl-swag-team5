import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const env = await configureApp(app);
  await app.listen(env.PORT);
  Logger.log(`SWAG API listening on http://localhost:${env.PORT}/v1`, 'Bootstrap');
}

void bootstrap();
