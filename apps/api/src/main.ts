import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { ensureStorage } from './common/storage-paths';
import { loadEnv } from './common/env';
import { validateRuntimeConfig } from './common/runtime-config';
import { PrismaService } from './common/database/prisma.service';
import { RedisQueueService } from './common/queue/redis-queue.service';
import { AiConfigService } from './common/ai-config/ai-config.service';

loadEnv();
validateRuntimeConfig();

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
  app.getHttpAdapter().getInstance().set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.use('/api/payments/wechat/notify', express.text({ type: ['text/xml', 'application/xml', '*/*'] }));
  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.use('/media/outputs', express.static(resolve(storage.outputs), {
    fallthrough: false,
    maxAge: process.env.APP_ENV === 'production' ? '1h' : 0,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
  }));

  app.getHttpAdapter().get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'picup-api', time: new Date().toISOString() });
  });

  app.getHttpAdapter().get('/api/ready', async (_req, res) => {
    const checks: Record<string, string> = {};
    try {
      await app.get(PrismaService).$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'failed';
    }
    try {
      await app.get(RedisQueueService).ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'failed';
    }
    try {
      app.get(AiConfigService).getConfig();
      checks.aiConfig = 'ok';
    } catch {
      checks.aiConfig = 'failed';
    }
    const ready = Object.values(checks).every((value) => value === 'ok');
    res.status(ready ? 200 : 503).json({ ok: ready, service: 'picup-api', checks, time: new Date().toISOString() });
  });

  app.getHttpAdapter().get('/api/ready/worker', async (_req, res) => {
    const heartbeat = await app.get(RedisQueueService).workerHeartbeat().catch(() => null);
    res.status(heartbeat ? 200 : 503).json({
      ok: Boolean(heartbeat),
      service: 'picup-worker',
      heartbeat
    });
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
