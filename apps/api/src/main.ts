import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { ensureStorage } from './common/storage-paths';
import { loadEnv } from './common/env';

loadEnv();

function getCorsOrigins() {
  const configuredOrigins = [
    process.env.WEB_PUBLIC_URL,
    process.env.API_CORS_ORIGINS
  ]
    .filter(Boolean)
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set([
    ...configuredOrigins,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001'
  ]));
}

async function bootstrap() {
  const storage = await ensureStorage();
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.use('/api/payments/wechat/notify', express.text({ type: ['text/xml', 'application/xml', '*/*'] }));
  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.use('/media', express.static(resolve(storage.root)));

  app.getHttpAdapter().get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'picup-api', time: new Date().toISOString() });
  });

  const port = Number(process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? '0.0.0.0';
  await app.listen(port, host);
  console.log(`PicUp API listening on http://${host}:${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
