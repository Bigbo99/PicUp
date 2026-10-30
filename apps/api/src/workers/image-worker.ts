import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { JobsService } from '../modules/jobs/jobs.service';
import { ensureStorage } from '../common/storage-paths';
import { loadEnv } from '../common/env';
import { RedisQueueService } from '../common/queue/redis-queue.service';
import { validateRuntimeConfig } from '../common/runtime-config';
import { withJobWatchdog } from './job-watchdog';

loadEnv();
validateRuntimeConfig();

async function bootstrap() {
  await ensureStorage();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const jobs = app.get(JobsService);
  const queue = app.get(RedisQueueService);
  const heartbeat = async () => queue.heartbeatWorker().catch((error) => console.error('[worker] heartbeat failed', error));
  await heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 10_000);
  heartbeatTimer.unref();
  console.log('PicUp image worker started');
  await jobs.restoreQueuedJobs();
  let restoring = false;
  const recoveryTimer = setInterval(async () => {
    if (restoring) return;
    restoring = true;
    try { await jobs.restoreQueuedJobs(); }
    catch (error) { console.error('[worker] recovery failed', error); }
    finally { restoring = false; }
  }, 15_000);
  recoveryTimer.unref();

  const configuredConcurrency = Number(process.env.IMAGE_WORKER_CONCURRENCY ?? 4);
  const concurrency = Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? Math.min(configuredConcurrency, 100)
    : 4;
  console.log(`PicUp image worker concurrency=${concurrency}`);

  // Hard ceiling per job slot — prevents a hung provider call from
  // blocking a worker slot indefinitely. Set to 1.5× the longest
  // expected provider timeout (default 10 min) via IMAGE_WORKER_JOB_TIMEOUT_MS.
  const configuredTimeout = Number(process.env.IMAGE_WORKER_JOB_TIMEOUT_MS);
  const jobHardTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout : 10 * 60 * 1000;

  await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
    while (true) {
      try {
        const processed = await withJobWatchdog(
          started => jobs.processNext(started),
          jobHardTimeoutMs,
          () => {
            console.error(`[worker ${index + 1}] job hard timeout after ${jobHardTimeoutMs}ms; restarting worker for lease recovery`);
            // Docker restarts the worker. Expired database leases are recovered
            // on startup; no abandoned consumers remain in this process.
            process.exit(1);
          }
        );
        if (processed) {
          console.log(`Worker ${index + 1} processed job ${processed.id}: ${processed.status}`);
        }
      } catch (error) {
        console.error(error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }));
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
