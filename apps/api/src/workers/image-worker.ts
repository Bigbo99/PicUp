import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { JobsService } from '../modules/jobs/jobs.service';
import { ensureStorage } from '../common/storage-paths';
import { loadEnv } from '../common/env';

loadEnv();

async function bootstrap() {
  await ensureStorage();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const jobs = app.get(JobsService);
  console.log('PicUp image worker started');
  await jobs.restoreQueuedJobs();

  const configuredConcurrency = Number(process.env.IMAGE_WORKER_CONCURRENCY ?? 4);
  const concurrency = Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? Math.min(configuredConcurrency, 100)
    : 4;
  console.log(`PicUp image worker concurrency=${concurrency}`);

  await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
    while (true) {
      try {
        const processed = await jobs.processNext();
        if (processed) {
          console.log(`Worker ${index + 1} processed job ${processed.id}: ${processed.status}`);
        }
      } catch (error) {
        console.error(error);
      }
    }
  }));
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
