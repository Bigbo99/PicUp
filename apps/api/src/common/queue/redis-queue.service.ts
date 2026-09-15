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
  private readonly readySetKey = `${this.queuePrefix}:ready:set`;
  private readonly processingKey = `${this.queuePrefix}:processing`;
  private readonly providerPrefix = `${this.queuePrefix}:providers`;
  private readonly workerHeartbeatKey = `${this.queuePrefix}:worker:heartbeat`;
  private client: RedisClientType | null = null;

  async onModuleInit() {
    this.client = createClient({ url: this.redisUrl });
    this.client.on('error', (error) => {
      console.error('[redis] queue client error', error);
    });
    await this.client.connect();
    // Rebuild the deduplication set only for queues created by the old
    // list-only implementation. Never delete an active set during a restart.
    if (!await this.client.exists(this.readySetKey)) {
      const readyIds = await this.client.lRange(this.queueKey, 0, -1);
      if (readyIds.length) await this.client.sAdd(this.readySetKey, readyIds);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  async ping() {
    return this.getClient().ping();
  }

  async heartbeatWorker(ttlSeconds = 30) {
    await this.getClient().set(this.workerHeartbeatKey, new Date().toISOString(), { EX: ttlSeconds });
  }

  async workerHeartbeat() {
    return this.getClient().get(this.workerHeartbeatKey);
  }

  async enqueueJob(jobId: string) {
    const client = this.getClient();
    await client.sendCommand(['EVAL',
      'if redis.call("SADD", KEYS[2], ARGV[1]) == 1 then redis.call("RPUSH", KEYS[1], ARGV[1]); return 1 end return 0',
      '2', this.queueKey, this.readySetKey, jobId]);
  }

  async dequeueJob() {
    const client = this.getClient();
    // Use an atomic move instead of a blocking command so acknowledgements,
    // leases and multiple worker consumers can share the same Redis client.
    while (true) {
      const jobId = await client.sendCommand(['EVAL',
        'local id = redis.call("LPOP", KEYS[1]); if id then redis.call("SREM", KEYS[3], id); redis.call("RPUSH", KEYS[2], id) end return id',
        '3', this.queueKey, this.processingKey, this.readySetKey]);
      if (typeof jobId === 'string' && jobId) return jobId;
      await this.sleep(250);
    }
  }

  async ackJob(jobId: string) {
    const client = this.getClient();
    await client.lRem(this.processingKey, 0, jobId);
  }

  async requeueJob(jobId: string) {
    const client = this.getClient();
    await client.sendCommand(['EVAL',
      'redis.call("LREM", KEYS[2], 0, ARGV[1]); if redis.call("SADD", KEYS[3], ARGV[1]) == 1 then redis.call("RPUSH", KEYS[1], ARGV[1]); return 1 end return 0',
      '3', this.queueKey, this.processingKey, this.readySetKey, jobId]);
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

  async renewProviderSlot(lease: ProviderSlotLease) {
    const result = await this.getClient().sendCommand(['EVAL',
      'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("EXPIRE", KEYS[1], 60) else return 0 end',
      '1', lease.key, lease.token]);
    return Number(result) === 1;
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
