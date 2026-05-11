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

  while (true) {
    try {
      const processed = await jobs.processNext();
      if (processed) {
        console.log(`Processed job ${processed.id}: ${processed.status}`);
      }
    } catch (error) {
      console.error(error);
    }
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
