import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { randomUUID } from 'node:crypto';

export interface ProviderSlotLease {
  key: string;
  token: string;
}

@Injectable()
export class RedisQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
  private readonly queuePrefix = process.env.REDIS_QUEUE_PREFIX ?? 'picup:image-jobs';
  private readonly queueKey = `${this.queuePrefix}:ready`;
  private readonly processingKey = `${this.queuePrefix}:processing`;
  private readonly providerPrefix = `${this.queuePrefix}:providers`;
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
    // Use an atomic move instead of a blocking command so acknowledgements,
    // leases and multiple worker consumers can share the same Redis client.
    while (true) {
      const jobId = await client.rPopLPush(this.queueKey, this.processingKey);
      if (jobId) return jobId;
      await this.sleep(250);
    }
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

  /**
   * Acquires one provider slot and one fixed-minute RPM token. Both limits are
   * coordinated in Redis so separate worker processes share the same budget.
   */
  async acquireProviderSlot(
    providerId: string,
    concurrency = 4,
    rpm = 0,
    leaseMs = 15 * 60 * 1000
  ): Promise<ProviderSlotLease> {
    const client = this.getClient();
    const slotCount = Math.max(1, Math.min(1000, Math.floor(Number(concurrency) || 1)));
    const requestsPerMinute = Math.max(0, Math.floor(Number(rpm) || 0));
    const leaseSeconds = Math.max(60, Math.ceil(leaseMs / 1000));
    const token = randomUUID();

    while (true) {
      for (let slot = 0; slot < slotCount; slot += 1) {
        const key = `${this.providerPrefix}:${providerId}:slot:${slot}`;
        const acquired = await client.set(key, token, { NX: true, EX: leaseSeconds });
        if (acquired !== 'OK') continue;

        if (requestsPerMinute === 0) return { key, token };
        const waitMs = await this.reserveRpmToken(providerId, requestsPerMinute);
        if (waitMs === 0) return { key, token };

        await this.releaseProviderSlot({ key, token });
        await this.sleep(waitMs);
        break;
      }

      await this.sleep(250);
    }
  }

  async releaseProviderSlot(lease: ProviderSlotLease) {
    const client = this.getClient();
    await client.sendCommand([
      'EVAL',
      'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
      '1',
      lease.key,
      lease.token
    ]);
  }

  private async reserveRpmToken(providerId: string, rpm: number) {
    const client = this.getClient();
    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const key = `${this.providerPrefix}:${providerId}:rpm:${windowStart}`;
    const result = await client.sendCommand([
      'EVAL',
      [
        'local current = tonumber(redis.call("GET", KEYS[1]) or "0")',
        'if current >= tonumber(ARGV[1]) then return 0 end',
        'local next = redis.call("INCR", KEYS[1])',
        'if next == 1 then redis.call("EXPIRE", KEYS[1], 70) end',
        'return 1'
      ].join('\n'),
      '1',
      key,
      String(rpm)
    ]);
    if (Number(result) === 1) return 0;
    return Math.max(250, windowStart + 60_000 - now + 50);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getClient() {
    if (!this.client) {
      throw new Error('Redis queue client is not connected');
    }
    return this.client;
  }
}
