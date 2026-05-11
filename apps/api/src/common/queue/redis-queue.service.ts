import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
  private readonly queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'picup:image-jobs';
  private readonly queueKey = `${this.queuePrefix}:ready`;
  private readonly processingKey = `${this.queuePrefix}:processing`;
  private client: RedisClientType | null = null;

  async onModuleInit() {
    this.client = createClient({ url: this.redisUrl });
    this.client.on('error', (error) => {
      console.error('[redis] queue client error', error);
    });
    await this.client.connect();
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  async enqueueJob(jobId: string) {
    const client = this.getClient();
    await client.rPush(this.queueKey, jobId);
  }

  async dequeueJob() {
    const client = this.getClient();
    return client.brPopLPush(this.queueKey, this.processingKey, 0);
  }

  async ackJob(jobId: string) {
    const client = this.getClient();
    await client.lRem(this.processingKey, 1, jobId);
  }

  async requeueJob(jobId: string) {
    const client = this.getClient();
    await client.lRem(this.processingKey, 1, jobId);
    await client.rPush(this.queueKey, jobId);
  }

  async restoreProcessingJobs() {
    const client = this.getClient();

    while (true) {
      const jobId = await client.rPopLPush(this.processingKey, this.queueKey);
      if (!jobId) break;
    }
  }

  private getClient() {
    if (!this.client) {
      throw new Error('Redis queue client is not connected');
    }
    return this.client;
  }
}
