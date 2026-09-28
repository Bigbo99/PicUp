import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser, ImageJobCreateRequest, ImageJobRecord } from '@picup/shared';
import type { ProviderSlotLease } from '../../common/queue/redis-queue.service';
import type { ProviderExecutionContext, ProviderImageInput, ProviderImageResult } from '../providers/provider.types';
import { CreateImageJobDto } from './dto';
import { JobsService } from './jobs.service';

const input: ImageJobCreateRequest = {
  mode: 'generate', provider: 'primary', model: 'image', template: 'freeform',
  prompt: 'A product photograph', imageIds: [], aspectRatio: '1:1', quality: '1K'
};
const user = { id: 'owner', role: 'user', isGuest: false, quotaUnlimited: false } as AuthUser;
const image = (name: string): ProviderImageResult => ({ images: [{ url: `/outputs/${name}.png`, mimeType: 'image/png' }], textOutputs: [] });

function setup() {
  const records = new Map<string, ImageJobRecord>();
  const requests: ProviderImageInput[] = [];
  const reservations: ImageJobRecord[] = [];
  const deleted: string[] = [];
  const events: string[] = [];
  const held = new Set<string>();
  const providerTokens = new Map<string, Set<string>>();
  const waiters = new Map<string, Array<() => void>>();
  const progress: ImageJobRecord[] = [];
  const budgets: Array<{ id: string; concurrency: number; rpm: number }> = [];
  let balance = 100;
  let ownsJob = true;
  let dailyLookups = 0;
  let generate = async (request: ProviderImageInput, _execution?: ProviderExecutionContext) => image(`image-${Number(request.outputKey!.split('-').at(-1)) + 1}`);
  const storage = {
    getJob: async (id: string) => records.has(id) ? structuredClone(records.get(id)) : undefined,
    getFiles: async () => [],
    getJobByIdempotency: async (_userId: string, key: string) => [...records.values()].find(job => job.idempotencyKey === key),
    hasEnoughCredits: async (_userId: string, credits: number) => balance >= credits,
    countDailyJobs: async () => { dailyLookups++; return 0; },
    createJobWithReservation: async (job: ImageJobRecord) => {
      records.set(job.id, job); reservations.push(job);
      return { created: true, job };
    },
    claimJob: async (id: string) => {
      const prior = records.get(id)!;
      if (prior.status !== 'queued' && prior.status !== 'retrying') return null;
      const job = { ...prior, status: 'running' as const, leaseOwner: `lease-${id}`, attempt: (prior.attempt ?? 0) + 1 };
      records.set(id, structuredClone(job)); return job;
    },
    renewJobLease: async () => ownsJob,
    updateJobExecutionRoute: async () => ownsJob,
    updateJobProgress: async (job: ImageJobRecord) => {
      if (!ownsJob) return false;
      const snapshot = structuredClone(job);
      progress.push(snapshot); records.set(job.id, snapshot); return true;
    },
    completeJob: async (job: ImageJobRecord) => { records.set(job.id, job); return job; },
    failJob: async (job: ImageJobRecord) => { records.set(job.id, job); return job; },
    requeueJobs: async (ids: string[]) => {
      ids.forEach(id => records.set(id, { ...records.get(id)!, status: 'queued', leaseOwner: null }));
      return true;
    }
  };
  const queue = {
    acquireProviderSlot: async (id: string, concurrency: number, rpm: number) => {
      const tokens = providerTokens.get(id) ?? new Set<string>();
      providerTokens.set(id, tokens);
      while (tokens.size >= concurrency) await new Promise<void>(resolve => {
        const pending = waiters.get(id) ?? []; pending.push(resolve); waiters.set(id, pending);
      });
      const lease = { key: id, token: randomUUID() };
      tokens.add(lease.token);
      held.add(lease.token); budgets.push({ id, concurrency, rpm }); events.push(`acquire:${id}`);
      return lease;
    },
    releaseProviderSlot: async (lease: ProviderSlotLease) => {
      held.delete(lease.token); providerTokens.get(lease.key)?.delete(lease.token);
      events.push(`release:${lease.key}`); waiters.get(lease.key)?.shift()?.();
    },
    renewProviderSlot: async (lease: ProviderSlotLease) => held.has(lease.token),
    enqueueJob: async () => {}, requeueJob: async () => {}, ackJob: async () => {}
  };
  const primary = { id: 'primary', type: 'openai-images', concurrency: 2, rpm: 10, timeoutMs: 30_000 };
  const backup = { ...primary, id: 'backup', concurrency: 1, rpm: 3 };
  const models = { resolveSelection: () => ({ provider: primary,
    model: { model: 'image', costCredits: 3, maxInputImages: 4, supportedRatios: ['1:1'], supportedQualities: ['1K'] }
  }) };
  const provider = { generate: async (request: ProviderImageInput, execution?: ProviderExecutionContext) => {
    requests.push(request); return generate(request, execution);
  } };
  const jobs = new JobsService({} as never, storage as never, queue as never, models as never,
    { get: () => provider } as never, { deleteByUrl: async (url: string) => { deleted.push(url); } } as never,
    {} as never, { getProvider: (id: string) => id === 'backup' ? backup : primary } as never);
  const insert = (count = 1) => {
    const id = randomUUID();
    const record: ImageJobRecord = { ...input, count, id, userId: user.id, status: 'queued',
      selectedProvider: 'primary', selectedModel: 'image', finalPrompt: input.prompt, inputFiles: [],
      outputImages: [], textOutputs: [], error: null, creditsReserved: count * 3, paymentMode: 'credits',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    records.set(id, record); return id;
  };
  return { jobs, insert, records, requests, reservations, deleted, events, held, budgets, storage, queue, progress, models,
    setBalance: (credits: number) => { balance = credits; },
    loseJob: () => { ownsJob = false; },
    regainJob: () => { ownsJob = true; },
    setGenerate: (callback: typeof generate) => { generate = callback; },
    dailyLookups: () => dailyLookups };
}

it('validates count through both the HTTP DTO and direct create/quote entry points', async () => {
  const h = setup();
  for (const count of [0, -1, 5, 1.5, '2', null, NaN]) {
    const request = { ...input, count } as ImageJobCreateRequest;
    if (count !== null) assert.ok((await validate(plainToInstance(CreateImageJobDto, request))).some(error => error.property === 'count'));
    await assert.rejects(h.jobs.quote(request, user), /1 至 4/);
    await assert.rejects(h.jobs.create(request, user), /1 至 4/);
  }
  for (const count of [1, 2, 3, 4]) {
    assert.equal((await validate(plainToInstance(CreateImageJobDto, { ...input, count }))).length, 0);
  }
  const preview = { ...input, mode: 'edit' as const, imageIds: [randomUUID()], previewOperation: 'describe' as const, count: 2 };
  await assert.rejects(h.jobs.quote(preview, user), /每次只能生成 1 张/);
  await assert.rejects(h.jobs.create(preview, user), /每次只能生成 1 张/);
});

it('validates custom sizes before reservation and passes exact dimensions to every batch output', async () => {
  const h = setup();
  for (const [width, height] of [[1600, undefined], [undefined, 1024], [null, 1024], ['1600', 1024], [1000, 1024], [512, 512], [3840, 3840], [2048, 512], [4096, 2048]]) {
    const request = { ...input, width, height } as ImageJobCreateRequest;
    await assert.rejects(h.jobs.quote(request, user));
    await assert.rejects(h.jobs.create(request, user));
  }
  assert.equal(h.reservations.length, 0);
  await assert.rejects(h.jobs.create({ ...input, width: 1600, height: 1024 }, user), /不支持自定义/);
  const resolve = h.models.resolveSelection;
  h.models.resolveSelection = () => {
    const selection = resolve();
    selection.model.model = 'gpt-image-2.5-flare';
    selection.model.supportedQualities = ['1K', '2K', '4K'];
    return selection;
  };
  const request = { ...input, model: 'gpt-image-2.5-flare', width: 1600, height: 1024, count: 3 };
  assert.equal((await validate(plainToInstance(CreateImageJobDto, request))).length, 0);
  assert.equal((await h.jobs.quote(request, user)).credits, 9);
  const created = await h.jobs.create(request, user);
  const saved = h.records.get(created.jobId!)!;
  assert.equal(saved.aspectRatio, '25:16');
  assert.equal(saved.quality, '2K');
  const result = await h.jobs.process(created.jobId!);
  assert.equal(result!.status, 'succeeded');
  assert.ok(h.requests.every(item => item.width === 1600 && item.height === 1024 && item.aspectRatio === '25:16' && item.quality === '2K'));
});

it('defaults old requests to one image and charges the same per-image cost for one to four images', async () => {
  const h = setup();
  const single = await h.jobs.create(input, user);
  assert.equal(h.records.get(single.jobId!)!.count, 1);
  assert.equal(single.creditsReserved, 3);
  for (const count of [1, 2, 3, 4]) {
    const request = { ...input, count, idempotencyKey: `batch-request-${count}` };
    assert.equal((await h.jobs.quote(request, user)).credits, count * 3);
    const created = await h.jobs.create(request, user);
    const duplicate = await h.jobs.create(request, user);
    assert.equal(created.creditsReserved, count * 3);
    assert.equal(duplicate.jobId, created.jobId);
    assert.equal(h.records.get(created.jobId!)!.count, count);
  }
  assert.equal(h.reservations.length, 5);
});

it('requires enough credits for a whole batch and keeps the daily free allowance for single images', async () => {
  const h = setup();
  h.setBalance(3);
  const quote = await h.jobs.quote({ ...input, count: 2 }, user);
  assert.equal(quote.available, false); assert.equal(quote.credits, 6);
  assert.match(quote.reason!, /积分不足/);
  await assert.rejects(h.jobs.create({ ...input, count: 2 }, user), /积分不足/);
  assert.equal(h.dailyLookups(), 0);
  h.setBalance(0);
  assert.equal((await h.jobs.quote(input, user)).paymentMode, 'free');
  assert.equal(h.dailyLookups(), 1);
  assert.equal(h.reservations.length, 0);
});

it('does not spend single-image payment orders on batches while allowing administrators and unlimited users', async () => {
  const h = setup();
  const paidSingle = { ...input, count: 4, paymentMode: 'single' as const, paymentOrderId: 'single-order' };
  assert.equal((await h.jobs.quote(paidSingle, user)).available, false);
  await assert.rejects(h.jobs.create(paidSingle, user), /积分支付/);
  await assert.rejects(h.jobs.create({ ...input, count: 2, paymentOrderId: 'single-order' }, user), /积分支付/);
  h.setBalance(0);
  for (const owner of [{ ...user, role: 'admin' as const }, { ...user, quotaUnlimited: true }]) {
    const quote = await h.jobs.quote({ ...input, count: 4 }, owner);
    assert.equal(quote.available, true); assert.equal(quote.credits, 0); assert.equal(quote.paymentMode, 'free');
  }
});

it('produces four distinct outputs with separate concurrency/RPM reservations and prevents duplicate execution', async () => {
  const h = setup();
  const id = h.insert(4);
  const result = await h.jobs.process(id);
  assert.equal(result!.status, 'succeeded'); assert.equal(result!.outputImages.length, 4);
  assert.equal(result!.creditsReserved, 12); assert.equal(result!.error, null);
  assert.equal(new Set(h.requests.map(request => request.outputKey)).size, 4);
  assert.equal(h.budgets.length, 4); assert.equal(h.held.size, 0);
  assert.equal((await h.jobs.process(id))!.id, id); assert.equal(h.requests.length, 4);
});

it('retains successful outputs when some images fail and bounds unexpected provider output counts', async () => {
  const h = setup();
  h.setGenerate(async request => {
    const index = Number(request.outputKey!.split('-').at(-1)) + 1;
    if (index === 2) throw new Error('upstream error');
    if (index === 3) return { images: [], textOutputs: ['No image'] };
    const output = image(`image-${index}`);
    return { ...output, images: [...output.images, ...image(`extra-${index}`).images] };
  });
  const result = await h.jobs.process(h.insert(4));
  assert.equal(result!.status, 'succeeded'); assert.equal(result!.outputImages.length, 2);
  assert.equal(result!.creditsReserved, 12); assert.equal(result!.error!.code, 'BATCH_PARTIAL_FAILURE');
  assert.match(result!.error!.message, /2\/4/);
  assert.deepEqual(h.deleted.sort(), ['/outputs/extra-1.png', '/outputs/extra-4.png']);
  assert.equal(h.held.size, 0);
});

it('uses the existing whole-job failure path when every image fails', async () => {
  const h = setup();
  h.setGenerate(async () => { throw new Error('provider unavailable'); });
  const result = await h.jobs.process(h.insert(3));
  assert.equal(result!.status, 'failed'); assert.equal(result!.error!.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(result!.outputImages.length, 0); assert.equal(h.requests.length, 3); assert.equal(h.held.size, 0);
});

it('releases fallback slots per output and restarts each independent request on the selected route', async () => {
  const h = setup();
  h.setGenerate(async (_request, execution) => {
    await execution!.switchProvider('backup'); return image(`fallback-${h.requests.length}`);
  });
  const result = await h.jobs.process(h.insert(2));
  assert.equal(result!.status, 'succeeded');
  assert.deepEqual(h.budgets.map(budget => budget.id).sort(), ['backup', 'backup', 'primary', 'primary']);
  assert.equal(h.events.filter(event => event === 'release:primary').length, 2);
  assert.equal(h.events.filter(event => event === 'release:backup').length, 2);
  assert.ok(h.events.indexOf('release:primary') < h.events.indexOf('acquire:backup'));
  assert.equal(result!.selectedProvider, 'backup'); assert.equal(h.held.size, 0);
});

it('cleans all uncommitted outputs and stops further requests after losing job ownership', async () => {
  const h = setup();
  h.setGenerate(async request => {
    const index = Number(request.outputKey!.split('-').at(-1)) + 1;
    h.loseJob();
    return image(`image-${index}`);
  });
  const result = await h.jobs.process(h.insert(4));
  assert.equal(result!.status, 'queued'); assert.ok(h.requests.length <= 2);
  assert.equal(h.deleted.length, h.requests.length);
  assert.equal(h.held.size, 0);
});

it('retains published outputs for retry when the final database transaction fails', async () => {
  const h = setup();
  h.storage.completeJob = async () => { throw new Error('database unavailable'); };
  const result = await h.jobs.process(h.insert(2));
  assert.equal(result!.status, 'queued'); assert.equal(h.held.size, 0);
  assert.equal(result!.outputImages.length, 2);
  assert.deepEqual(h.deleted, []);
});

const eventually = async (predicate: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for parallel work');
};

it('runs outputs concurrently within provider capacity and publishes each completed slot immediately', async () => {
  const h = setup();
  const gates = new Map<number, () => void>();
  h.setGenerate(async request => {
    const slot = Number(request.outputKey!.split('-').at(-1));
    await new Promise<void>(resolve => gates.set(slot, resolve));
    return image(`slot-${slot}`);
  });
  const id = h.insert(3);
  const pending = h.jobs.process(id);
  await eventually(() => gates.size === 2);
  assert.equal(h.held.size, 2);
  assert.equal(h.records.get(id)!.outputProgress![2].status, 'queued');
  gates.get(1)!();
  await eventually(() => gates.has(2));
  const partial = h.records.get(id)!;
  assert.equal(partial.status, 'running');
  assert.equal(partial.outputImages.length, 1);
  assert.deepEqual(partial.outputProgress![1], { status: 'succeeded', outputIndex: 0 });
  assert.equal(partial.outputProgress![0].status, 'running');
  gates.get(2)!(); gates.get(0)!();
  const result = await pending;
  assert.equal(result!.outputImages.length, 3);
  assert.equal(result!.outputImages[result!.outputProgress![1].outputIndex!].url, '/outputs/slot-1.png');
  assert.equal(h.held.size, 0);
});

it('resumes only unfinished slots after worker ownership is lost', async () => {
  const h = setup();
  let finishSecond: () => void = () => {};
  h.setGenerate(async request => {
    const slot = Number(request.outputKey!.split('-').at(-1));
    if (slot === 1) await new Promise<void>(resolve => { finishSecond = resolve; });
    return image(`slot-${slot}`);
  });
  const id = h.insert(2);
  const pending = h.jobs.process(id);
  await eventually(() => h.records.get(id)!.outputImages.length === 1);
  h.loseJob(); finishSecond();
  const interrupted = await pending;
  assert.equal(interrupted!.outputImages[0].url, '/outputs/slot-0.png');
  assert.deepEqual(h.deleted, ['/outputs/slot-1.png']);
  h.regainJob(); h.setGenerate(async () => image('resumed'));
  const result = await h.jobs.process(id);
  assert.equal(result!.status, 'succeeded');
  assert.equal(result!.outputImages.length, 2);
  assert.equal(h.requests.length, 3);
  assert.equal(result!.outputImages[0].url, '/outputs/slot-0.png');
});
