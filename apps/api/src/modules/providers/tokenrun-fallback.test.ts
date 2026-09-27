import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it, type TestContext } from 'node:test';
import type { ImageJobRecord } from '@picup/shared';
import { AiConfigService } from '../../common/ai-config/ai-config.service';
import type { AiProviderConfig } from '../../common/ai-config/ai-config.types';
import type { ProviderSlotLease } from '../../common/queue/redis-queue.service';
import { JobsService } from '../jobs/jobs.service';
import { TokenRunProvider } from './tokenrun.provider';
import type { ProviderImageInput } from './provider.types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function setup(t: TestContext) {
  const makeProvider = (id: string, concurrency: number, rpm: number): AiProviderConfig => ({
    id, type: 'openai-images', displayName: id, enabled: true, apiKey: 'mock-key',
    aliases: [`${id}-alias`], baseUrl: `https://${id}.example.test`, paths: { generations: '/generate', edits: '/edit' },
    defaultModel: 'image', timeoutMs: 30_000, concurrency, rpm,
    models: [{ model: 'image', displayName: 'Image', description: '', enabled: true,
      maxInputImages: 4, supportedRatios: ['auto'], supportedQualities: ['1K'], costCredits: 1 }]
  });
  const primary = { ...makeProvider('primary', 4, 20), fallbackProviderIds: ['backup'] };
  const backup = { ...makeProvider('backup', 1, 3), fallbackOnly: true };
  const ai = new AiConfigService();
  ai.getConfig = () => ({ version: 1, mockEnabled: false, providers: [primary, backup],
    routing: { default: { provider: primary.id, model: 'image' }, professional: { provider: primary.id, model: 'image' } } });
  const objects = { save: async (_kind: string, name: string) => `/outputs/${name}`, deleteByUrl: async () => {} };
  const provider = new TokenRunProvider(objects as never, ai);
  const records = new Map<string, ImageJobRecord>();
  const held = new Map<string, ProviderSlotLease[]>();
  const waiting = new Map<string, Array<() => void>>();
  const events: string[] = [];
  const budgets: Array<{ id: string; concurrency: number; rpm: number; timeoutMs: number }> = [];
  const blocked = deferred<void>();
  const heartbeats: Array<() => Promise<void>> = [];
  t.mock.method(globalThis, 'setInterval', (callback: () => Promise<void>) => {
    heartbeats.push(callback);
    return { unref() {} };
  });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const queue = {
    acquireProviderSlot: async (id: string, concurrency: number, rpm: number, timeoutMs: number) => {
      budgets.push({ id, concurrency, rpm, timeoutMs });
      while ((held.get(id)?.length ?? 0) >= concurrency) {
        await new Promise<void>(resolve => {
          waiting.set(id, [...waiting.get(id) ?? [], resolve]);
          blocked.resolve();
        });
      }
      const lease = { key: id, token: randomUUID() };
      held.set(id, [...held.get(id) ?? [], lease]);
      events.push(`acquire:${id}`);
      return lease;
    },
    renewProviderSlot: async (lease: ProviderSlotLease) => {
      events.push(`renew:${lease.key}`);
      return held.get(lease.key)?.some(item => item.token === lease.token) ?? false;
    },
    releaseProviderSlot: async (lease: ProviderSlotLease) => {
      held.set(lease.key, (held.get(lease.key) ?? []).filter(item => item.token !== lease.token));
      events.push(`release:${lease.key}`);
      waiting.get(lease.key)?.shift()?.();
    },
    requeueJob: async () => {}, ackJob: async () => {}
  };
  let ownsJob = true;
  const storage = {
    getJob: async (id: string) => records.get(id),
    claimJob: async (id: string) => {
      const job = { ...records.get(id)!, status: 'running' as const, leaseOwner: id };
      records.set(id, job); return job;
    },
    renewJobLease: async () => ownsJob,
    completeJob: async (job: ImageJobRecord) => { records.set(job.id, job); return job; },
    failJob: async (job: ImageJobRecord) => { records.set(job.id, job); return job; },
    requeueJobs: async (ids: string[]) => {
      for (const id of ids) records.set(id, { ...records.get(id)!, status: 'queued' });
      return true;
    }
  };
  const jobs = new JobsService({} as never, storage as never, queue as never, {} as never,
    { get: () => provider } as never, objects as never, {} as never, ai);
  const run = (id: string) => {
    records.set(id, { id, status: 'queued', provider: 'primary', model: 'image', selectedProvider: 'primary', selectedModel: 'image',
      quality: '1K', aspectRatio: 'auto', inputFiles: [], finalPrompt: 'mock', outputImages: [], textOutputs: [] } as unknown as ImageJobRecord);
    return jobs.process(id);
  };
  return { run, provider, primary, backup, held, events, budgets, blocked, heartbeats, queue, loseJob: () => { ownsJob = false; } };
}

const imageResponse = () => Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });

it('releases primary slots before failover and shares the backup concurrency and RPM budget', async t => {
  const h = setup(t);
  const entered = deferred<void>();
  const unblock = deferred<void>();
  let active = 0;
  let maximum = 0;
  let backupRequests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('primary.')) return new Response('unavailable', { status: 503 });
    maximum = Math.max(maximum, ++active);
    backupRequests++;
    if (backupRequests === 1) { entered.resolve(); await unblock.promise; }
    active--;
    return imageResponse();
  });
  const first = h.run('one');
  await entered.promise;
  const second = h.run('two');
  await h.blocked.promise;
  assert.equal(h.held.get('primary')!.length, 0);
  await h.heartbeats[0]();
  assert.ok(h.events.includes('renew:backup'));
  unblock.resolve();
  const results = await Promise.all([first, second]);
  assert.ok(results.every(job => job?.status === 'succeeded'));
  assert.equal(maximum, 1);
  assert.equal(backupRequests, 2);
  assert.deepEqual(h.budgets.filter(value => value.id === 'backup'), [
    { id: 'backup', concurrency: 1, rpm: 3, timeoutMs: 30_000 },
    { id: 'backup', concurrency: 1, rpm: 3, timeoutMs: 30_000 }
  ]);
  assert.ok([...h.held.values()].every(leases => leases.length === 0));
});

it('releases the backup slot on a failed request and deduplicates canonical provider aliases', async t => {
  const h = setup(t);
  h.primary.fallbackProviderIds = ['primary-alias', 'missing', 'backup', 'backup-alias'];
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('unavailable', { status: 503 }); });
  assert.equal((await h.run('failed'))?.status, 'failed');
  assert.equal(requests, 2);
  assert.deepEqual(h.events.filter(value => value.startsWith('release:')), ['release:primary', 'release:backup']);
});

it('stops before the backup request when job ownership is lost while waiting for its slot', async t => {
  const h = setup(t);
  const acquire = h.queue.acquireProviderSlot;
  h.queue.acquireProviderSlot = async (...args) => {
    const lease = await acquire(...args);
    if (args[0] === 'backup') h.loseJob();
    return lease;
  };
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('unavailable', { status: 503 }); });
  assert.equal((await h.run('lost'))?.status, 'queued');
  assert.equal(requests, 1);
  assert.ok([...h.held.values()].every(leases => leases.length === 0));
});

it('refuses uncoordinated direct failover without a worker execution context', async t => {
  const h = setup(t);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('unavailable', { status: 503 }); });
  const input: ProviderImageInput = { jobId: 'direct', provider: 'primary', model: 'image', quality: '1K', aspectRatio: 'auto',
    images: [], prompt: 'mock', mode: 'generate', template: 'freeform', automaticModelSelection: false };
  await assert.rejects(h.provider.generate(input), /任务执行上下文/);
  assert.equal(requests, 1);
});
