import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { validate } from 'class-validator';
import type { ImageJobRecord } from '@picup/shared';
import { PrismaService } from './database/prisma.service';
import { StorageService } from './storage.service';
import { CreateImageJobDto } from '../modules/jobs/dto';
import { JobsService } from '../modules/jobs/jobs.service';
import { RedisQueueService } from './queue/redis-queue.service';
import { FilesService } from '../modules/files/files.service';
import { StudioController } from '../modules/jobs/studio.controller';
import { AuthService } from '../modules/auth/auth.service';

it('preserves theme when a partial preference DTO contains undefined fields', async () => {
  const tx = { $queryRaw: async () => [], studioPreference: {
    findUnique: async () => ({ settings: { theme: 'dark', quality: '1K' } }),
    upsert: async (args: { update: { settings: unknown } }) => args.update
  } };
  const controller = new StudioController({ $transaction: async (fn: (value: unknown) => unknown) => fn(tx) } as never);
  const result = await controller.savePreferences({ theme: undefined, quality: '2K' }, { authUser: { id: randomUUID() } } as never);
  assert.deepEqual(result, { theme: 'dark', quality: '2K' });
});

it('only reads image objects owned by the requesting user', async () => {
  const id = randomUUID();
  let reads = 0;
  const service = new FilesService({ getFiles: async (_ids: string[], userId: string) => userId === 'owner' ? [{ url: 'private-object', mimeType: 'image/png' }] : [] } as never,
    { readByUrl: async () => { reads++; return Buffer.from('image'); } } as never);
  await assert.rejects(() => service.readForUser(id, { id: 'other' } as never));
  assert.equal(reads, 0);
  const result = await service.readForUser(id, { id: 'owner' } as never);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(reads, 1);
});

it('uses image content MIME when a PNG is uploaded with a JPEG filename', async () => {
  const stored: unknown[][] = [];
  const service = new FilesService({ findFileByHash: async () => null, addFile: async (file: unknown) => file } as never,
    { save: async (...args: unknown[]) => { stored.push(args); return '/inputs/image.png'; } } as never);
  const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const result = await service.saveUploadedFile({ buffer, size: buffer.length, mimetype: 'image/jpeg' } as Express.Multer.File, { id: 'test' } as never);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(stored[0][3], 'image/png');
  await assert.rejects(() => service.saveUploadedFile({ buffer: Buffer.from('<html>'), size: 6, mimetype: 'image/png' } as Express.Multer.File, { id: 'test' } as never));
});

it('accepts uploaded UUID references and rejects duplicates', async () => {
  const dto = Object.assign(new CreateImageJobDto(), {
    mode: 'edit', provider: 'auto', model: 'auto', template: 'auto', prompt: 'edit image',
    imageIds: [randomUUID()], quality: '1K', aspectRatio: 'auto'
  });
  assert.deepEqual(await validate(dto), []);
  dto.imageIds.push(dto.imageIds[0]);
  assert.ok((await validate(dto)).some(error => error.property === 'imageIds'));
});

it('recovery only requeues jobs selected by the database, never all processing jobs', async () => {
  const calls: string[] = [];
  const storage = {
    requeueExpiredJobs: async () => { calls.push('expire'); },
    listRecoverableJobIds: async () => ['orphan']
  };
  const queue = { requeueJob: async (id: string) => { calls.push(id); } };
  const jobs = new JobsService({} as never, storage as never, queue as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  await jobs.restoreQueuedJobs();
  assert.deepEqual(calls, ['expire', 'orphan']);
});

// Run against a disposable database only; the suite creates and removes its own users.
describe('studio database consistency', { skip: !process.env.TEST_DATABASE_URL }, () => {
  const prisma = new PrismaService({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const storage = new StorageService(prisma);
  const userIds: string[] = [];
  before(() => prisma.$connect());
  after(async () => {
    await prisma.creditEntry.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.paymentOrder.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.imageJob.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.studioSubject.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.fileRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });
  async function user(creditBalance = 10) {
    const record = await prisma.user.create({ data: { isGuest: false, role: 'user', creditBalance } });
    userIds.push(record.id);
    return record;
  }
  async function registeredAccount(auth: AuthService, response: Parameters<AuthService['verifyEmailAuth']>[1]) {
    let code = '';
    (auth as unknown as { deliverEmailCode(email: string, code: string): Promise<boolean> }).deliverEmailCode = async (_email, value) => {
      code = value;
      return true;
    };
    const challenge = await auth.startEmailAuth({ email: `${randomUUID()}@example.test`, password: 'test-password-123', mode: 'register', termsAccepted: true });
    return auth.verifyEmailAuth({ challengeId: challenge.challengeId, code }, response);
  }
  it('profile writes preserve committed balance changes and cannot restore disabled accounts', async () => {
    const record = await user(10);
    await prisma.user.update({ where: { id: record.id }, data: { creditBalance: { decrement: 1 } } });
    const saved = await storage.updateUser(record.id, { displayName: 'Changed nickname' });
    assert.equal(saved.creditBalance, 9);
    await prisma.user.update({ where: { id: record.id }, data: { status: 'disabled' } });
    await assert.rejects(storage.updateUser(record.id, { displayName: 'Cannot save' }));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: record.id } })).status, 'disabled');
  });
  it('login transfers guest references without changing IDs, including duplicate images and subjects', async () => {
    const auth = new AuthService(storage, prisma);
    let token = '';
    const response = { cookie: (_name: string, value: string) => { token = value; } } as never;
    const account = await registeredAccount(auth, response);
    userIds.push(account.user.id);
    const guest = await auth.ensureRequestUser({ headers: {}, socket: {} } as never, response);
    userIds.push(guest.id);
    const guestToken = token;
    const hash = 'a'.repeat(64);
    const fileData = { hash, url: '/media/inputs/test.png', mimeType: 'image/png', size: 8 };
    await prisma.fileRecord.create({ data: { ...fileData, userId: account.user.id } });
    const file = await prisma.fileRecord.create({ data: { ...fileData, userId: guest.id } });
    const subject = await prisma.studioSubject.create({ data: { userId: guest.id, fileId: file.id, name: 'test subject' } });
    const req = { headers: { cookie: `picup_session=${guestToken}` }, socket: {} } as never;
    await assert.rejects(() => auth.login({ email: account.user.email!, password: 'wrong-password' }, response, req));
    assert.equal((await prisma.fileRecord.findUniqueOrThrow({ where: { id: file.id } })).userId, guest.id);
    await auth.login({ email: account.user.email!, password: 'test-password-123' }, response, req);
    assert.equal((await storage.getFiles([file.id], account.user.id))[0]?.id, file.id);
    assert.equal((await storage.getFiles([file.id], guest.id)).length, 0);
    assert.equal((await prisma.studioSubject.findUniqueOrThrow({ where: { id: subject.id } })).userId, account.user.id);
    assert.equal(await prisma.fileRecord.count({ where: { userId: account.user.id } }), 2);
    await storage.transferGuestFiles(guest.id, account.user.id);
    assert.equal(await prisma.fileRecord.count({ where: { userId: account.user.id } }), 2);
    const other = await user();
    await storage.transferGuestFiles(account.user.id, other.id);
    assert.equal((await storage.getFiles([file.id], other.id)).length, 0);
  });
  it('a forged guest cookie cannot transfer another guest uploads', async () => {
    const auth = new AuthService(storage, prisma);
    const response = { cookie: () => {} } as never;
    const account = await registeredAccount(auth, response);
    userIds.push(account.user.id);
    const guest = await auth.ensureRequestUser({ headers: {}, socket: {} } as never, response);
    userIds.push(guest.id);
    const file = await prisma.fileRecord.create({ data: { userId: guest.id, url: '/test.png', mimeType: 'image/png', size: 8 } });
    const payload = Buffer.from(JSON.stringify({ sub: guest.id, role: 'guest', exp: 9999999999 })).toString('base64url');
    await auth.login({ email: account.user.email!, password: 'test-password-123' }, response,
      { headers: { cookie: `picup_session=${payload}.invalid` }, socket: {} } as never);
    assert.equal((await prisma.fileRecord.findUniqueOrThrow({ where: { id: file.id } })).userId, guest.id);
  });
  it('anonymous reads do not create guest rows; the first write does', async () => {
    const auth = new AuthService(storage, prisma);
    const cookies: string[] = [];
    const response = { cookie: (_name: string, value: string) => { cookies.push(value); } } as never;
    const reader = await auth.ensureRequestUser({ method: 'GET', headers: {}, socket: {} } as never, response);
    assert.equal(reader.isGuest, true);
    assert.equal(await prisma.user.count({ where: { id: reader.id } }), 0);
    assert.equal(cookies.length, 0);
    const writer = await auth.ensureRequestUser({ method: 'POST', headers: {}, socket: {} } as never, response);
    userIds.push(writer.id);
    assert.equal(await prisma.user.count({ where: { id: writer.id, isGuest: true } }), 1);
    assert.equal(cookies.length, 1);
    const returning = await auth.ensureRequestUser({ method: 'GET', headers: { cookie: `picup_session=${cookies[0]}` }, socket: {} } as never, response);
    assert.equal(returning.id, writer.id);
  });
  function job(userId: string, paymentMode: 'free' | 'credits' | 'single' = 'credits'): ImageJobRecord {
    return {
      id: randomUUID(), userId, mode: 'generate', provider: 'auto', model: 'auto', template: 'auto',
      prompt: 'test', finalPrompt: 'test', imageIds: [], inputFiles: [], outputImages: [], textOutputs: [],
      quality: '1K', aspectRatio: 'auto', status: 'queued', selectedProvider: 'mock', selectedModel: 'mock',
      creditsReserved: 2, paymentMode, error: null, idempotencyKey: randomUUID(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }
  it('concurrent payment notifications credit an order exactly once', async () => {
    const owner = await user(0);
    const order = await prisma.paymentOrder.create({ data: {
      userId: owner.id, externalOrderId: randomUUID(), amountCents: 990, credits: 20
    } });
    await Promise.all(Array.from({ length: 8 }, () => storage.markPaymentOrderPaid(order.externalOrderId!)));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 20);
    assert.equal(await prisma.creditEntry.count({ where: { userId: owner.id } }), 1);
  });
  it('asset metadata is private and removing assets preserves conversation history', async () => {
    const owner = await user(); const other = await user();
    const studio = new StudioController(prisma);
    const req = { authUser: { id: owner.id } } as never;
    const foreign = { authUser: { id: other.id } } as never;
    const root = job(owner.id);
    await storage.createJobWithReservation(root);
    await prisma.imageJob.update({ where: { id: root.id }, data: { status: 'succeeded', outputImages: [{ url: '/test.png' }] } });
    const child = { ...job(owner.id), parentJobId: root.id, prompt: 'second turn' };
    await storage.createJobWithReservation(child);
    const key = `job:${root.id}:0`;
    await studio.updateAsset(key, { title: 'renamed' }, req);
    assert.equal((await studio.listAssets(req, 'renamed')).items.length, 1);
    await assert.rejects(studio.updateAsset(key, { hidden: true }, foreign));
    await studio.updateAsset(key, { hidden: true }, req);
    assert.equal((await studio.listAssets(req)).items.length, 0);
    const conversations = await studio.conversations(req);
    assert.equal(conversations.items.length, 1);
    assert.equal(conversations.items[0].count, 2);
    assert.equal(conversations.items[0].jobId, child.id);
    assert.equal((await studio.conversations(foreign)).items.length, 0);
  });
  it('concurrent preferences merge without losing unrelated settings', async () => {
    const owner = await user(); const studio = new StudioController(prisma);
    const req = { authUser: { id: owner.id } } as never;
    await Promise.all([studio.savePreferences({ theme: 'dark' }, req), studio.savePreferences({ quality: '2K' }, req)]);
    assert.deepEqual(await studio.preferences(req), { theme: 'dark', quality: '2K' });
  });
  it('duplicate requests reserve credits only once', async () => {
    const owner = await user();
    const input = job(owner.id);
    const results = await Promise.all(Array.from({ length: 4 }, () => storage.createJobWithReservation({ ...input, id: randomUUID() })));
    assert.equal(new Set(results.map(result => result.job.id)).size, 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 8);
  });
  it('persists batch count and reserves the entire batch only once', async () => {
    const owner = await user(20);
    const input = { ...job(owner.id), count: 4, creditsReserved: 8 };
    const results = await Promise.all(Array.from({ length: 4 }, () => storage.createJobWithReservation({ ...input, id: randomUUID() })));
    assert.equal(new Set(results.map(result => result.job.id)).size, 1);
    assert.ok(results.every(result => result.job.count === 4 && result.job.creditsRefunded === 0));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 12);
  });
  it('publishes per-image progress under the active lease and retains it across worker recovery', async () => {
    const owner = await user(20);
    const input = { ...job(owner.id), count: 3, creditsReserved: 6, width: 1600, height: 1024 };
    await storage.createJobWithReservation(input);
    const running = (await storage.claimJob(input.id, 'first-worker', 60_000))!;
    const progress: ImageJobRecord = { ...running,
      outputImages: [{ url: '/early-result.png', mimeType: 'image/png' }],
      outputProgress: [{ status: 'running' }, { status: 'succeeded', outputIndex: 0 }, { status: 'queued' }] };
    assert.equal(await storage.updateJobProgress(progress, 'stale-worker'), false);
    assert.equal((await storage.getJob(input.id))!.outputImages.length, 0);
    assert.equal(await storage.updateJobProgress(progress, 'first-worker'), true);
    const published = (await storage.getJob(input.id))!;
    assert.equal(published.status, 'running');
    assert.deepEqual(published.outputProgress, progress.outputProgress);
    await storage.requeueJobs([input.id], 'first-worker');
    const resumed = (await storage.claimJob(input.id, 'next-worker', 60_000))!;
    assert.deepEqual(resumed.outputImages, progress.outputImages);
    assert.equal(resumed.width, 1600);
    assert.equal(resumed.height, 1024);
    assert.equal(await storage.updateJobProgress({ ...progress, outputImages: [] }, 'first-worker'), false);
    assert.equal((await storage.getJob(input.id))!.outputImages.length, 1);
  });
  it('settles only missing outputs when a partially published batch exhausts retries', async () => {
    const owner = await user(20);
    const input = { ...job(owner.id), count: 3, creditsReserved: 6 };
    await storage.createJobWithReservation(input);
    const running = (await storage.claimJob(input.id, 'worker', 60_000))!;
    await storage.updateJobProgress({ ...running, outputImages: [{ url: '/kept.png', mimeType: 'image/png' }],
      outputProgress: [{ status: 'succeeded', outputIndex: 0 }, { status: 'running' }, { status: 'queued' }] }, 'worker');
    await prisma.imageJob.update({ where: { id: input.id }, data: { attempt: 20, leaseExpiresAt: new Date(0) } });
    const settled = await storage.claimJob(input.id, 'last-worker', 60_000);
    assert.equal(settled!.status, 'succeeded');
    assert.equal(settled!.error?.code, 'BATCH_PARTIAL_FAILURE');
    assert.equal(settled!.creditsRefunded, 4);
    assert.equal(settled!.outputImages[0].url, '/kept.png');
    assert.deepEqual(settled!.outputProgress?.map(slot => slot.status), ['succeeded', 'failed', 'failed']);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 18);
    await storage.claimJob(input.id, 'duplicate-worker', 60_000);
    assert.equal(await prisma.creditEntry.count({ where: { userId: owner.id, kind: 'refund' } }), 1);
  });
  it('atomically publishes partial batch results and refunds missing images exactly once', async () => {
    const owner = await user(20);
    const input = { ...job(owner.id), count: 4, creditsReserved: 8 };
    await storage.createJobWithReservation(input);
    await storage.claimJob(input.id, 'batch-worker', 60_000);
    const completed = { ...input, status: 'succeeded' as const, leaseOwner: null, leaseExpiresAt: null,
      outputImages: [{ url: '/batch-1.png', mimeType: 'image/png' }, { url: '/batch-2.png', mimeType: 'image/png' }],
      error: { code: 'BATCH_PARTIAL_FAILURE', message: '2 of 4 images generated' } };
    const results = await Promise.all(Array.from({ length: 3 }, () => storage.completeJob(completed, 'batch-worker')));
    assert.equal(results.filter(Boolean).length, 1);
    const saved = await storage.getJob(input.id);
    assert.equal(saved?.status, 'succeeded');
    assert.equal(saved?.count, 4);
    assert.equal(saved?.outputImages.length, 2);
    assert.equal(saved?.creditsReserved, 8);
    assert.equal(saved?.creditsRefunded, 4);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 16);
    assert.equal(await prisma.creditEntry.count({ where: { userId: owner.id, kind: 'refund' } }), 1);
    await storage.failJob(input, 'batch-worker');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 16);
  });
  it('refunds a fully failed batch once and prevents stale workers from partially settling it', async () => {
    const owner = await user(20);
    const input = { ...job(owner.id), count: 3, creditsReserved: 6 };
    await storage.createJobWithReservation(input);
    await storage.claimJob(input.id, 'owner-worker', 60_000);
    assert.equal(await storage.completeJob({ ...input, status: 'succeeded', outputImages: [{ url: '/stale.png', mimeType: 'image/png' }] }, 'stale-worker'), null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 14);
    const failed = await storage.failJob(input, 'owner-worker');
    assert.equal(failed?.status, 'refunded');
    assert.equal(failed?.creditsRefunded, 6);
    await storage.failJob(input, 'owner-worker');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 20);
    assert.equal(await prisma.creditEntry.count({ where: { userId: owner.id, kind: 'refund' } }), 1);
  });
  it('does not refund a complete batch or charge an unlimited free batch', async () => {
    const owner = await user(20);
    const input = { ...job(owner.id), count: 2, creditsReserved: 4 };
    await storage.createJobWithReservation(input);
    await storage.claimJob(input.id, 'batch-worker', 60_000);
    const complete = await storage.completeJob({ ...input, status: 'succeeded', outputImages: [
      { url: '/first.png', mimeType: 'image/png' }, { url: '/second.png', mimeType: 'image/png' }
    ] }, 'batch-worker');
    assert.equal(complete?.creditsRefunded, 0);
    const free = { ...job(owner.id, 'free'), count: 4, creditsReserved: 8 };
    await assert.rejects(storage.createJobWithReservation(free), /积分/);
    await assert.rejects(storage.createJobWithReservation({ ...job(owner.id, 'single'), count: 4 }), /积分/);
    await storage.createJobWithReservation(free, true);
    await storage.claimJob(free.id, 'free-worker', 60_000);
    const partial = await storage.completeJob({ ...free, status: 'succeeded', outputImages: [{ url: '/free.png', mimeType: 'image/png' }] }, 'free-worker');
    assert.equal(partial?.creditsRefunded, 0);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 16);
  });
  it('hiding a free task does not restore quota', async () => {
    const owner = await user();
    const input = job(owner.id, 'free');
    await storage.createJobWithReservation(input);
    await storage.deleteJob(input.id, owner.id);
    assert.deepEqual(await storage.listJobs(20, owner.id), []);
    assert.equal(await storage.countDailyJobs(owner.id, input.createdAt.slice(0, 10)), 1);
    await assert.rejects(storage.createJobWithReservation(job(owner.id, 'free')), /免费次数/);
  });
  it('concurrent free requests cannot consume the same daily allowance twice', async () => {
    const owner = await user();
    const results = await Promise.allSettled([storage.createJobWithReservation(job(owner.id, 'free')), storage.createJobWithReservation(job(owner.id, 'free'))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await storage.countDailyJobs(owner.id, new Date().toISOString().slice(0, 10)), 1);
  });
  it('finishing a hidden running task does not make it visible again', async () => {
    const owner = await user();
    const input = job(owner.id);
    await storage.createJobWithReservation(input);
    await storage.claimJob(input.id, 'worker', 60_000);
    await storage.deleteJob(input.id, owner.id);
    await storage.completeJob({ ...input, status: 'succeeded', leaseOwner: null, leaseExpiresAt: null }, 'worker');
    assert.equal((await storage.getJob(input.id))?.status, 'succeeded');
    assert.equal(await storage.getJob(input.id, owner.id), null);
  });
  it('hiding a single-payment task does not release the payment order', async () => {
    const owner = await user();
    const order = await prisma.paymentOrder.create({ data: { userId: owner.id, amountCents: 50, status: 'paid', orderType: 'single_job' } });
    const input = { ...job(owner.id, 'single'), paymentOrderId: order.id };
    await storage.createJobWithReservation(input);
    await storage.deleteJob(input.id, owner.id);
    assert.equal(await storage.isPaymentOrderUsed(order.id), true);
  });
  it('active leases survive recovery and stale workers cannot overwrite the new owner', async () => {
    const owner = await user();
    const input = job(owner.id);
    await storage.createJobWithReservation(input);
    await storage.claimJob(input.id, 'old-worker', 60_000);
    await storage.requeueExpiredJobs();
    assert.equal((await storage.getJob(input.id))?.status, 'running');
    await prisma.imageJob.update({ where: { id: input.id }, data: { leaseExpiresAt: new Date(0) } });
    await storage.requeueExpiredJobs();
    await storage.claimJob(input.id, 'new-worker', 60_000);
    await storage.completeJob({ ...input, status: 'succeeded' }, 'old-worker');
    await storage.failJob({ ...input, status: 'failed' }, 'old-worker');
    assert.equal((await storage.getJob(input.id))?.leaseOwner, 'new-worker');
    await storage.failJob({ ...input, status: 'failed' }, 'new-worker');
    await storage.failJob({ ...input, status: 'failed' }, 'new-worker');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).creditBalance, 10);
    assert.equal(await prisma.creditEntry.count({ where: { userId: owner.id, kind: 'refund' } }), 1);
  });
});

describe('isolated Redis queue', { skip: !process.env.TEST_REDIS_URL }, () => {
  let queue: RedisQueueService;
  before(async () => {
    process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.REDIS_QUEUE_PREFIX = `picup:test:${randomUUID()}`;
    queue = new RedisQueueService();
    await queue.onModuleInit();
  });
  after(async () => { await queue?.onModuleDestroy(); });
  it('deduplicates ready jobs and consumes FIFO', async () => {
    await queue.enqueueJob('first'); await queue.enqueueJob('first'); await queue.enqueueJob('second');
    assert.equal(await queue.dequeueJob(), 'first');
    assert.equal(await queue.dequeueJob(), 'second');
    await queue.ackJob('first'); await queue.ackJob('second');
  });
  it('recovers a processing item once and protects slot ownership', async () => {
    await queue.enqueueJob('recover'); assert.equal(await queue.dequeueJob(), 'recover');
    await queue.requeueJob('recover'); await queue.requeueJob('recover');
    await queue.enqueueJob('sentinel');
    assert.equal(await queue.dequeueJob(), 'recover'); assert.equal(await queue.dequeueJob(), 'sentinel');
    await queue.ackJob('recover'); await queue.ackJob('sentinel');
    const lease = await queue.acquireProviderSlot('test', 1, 0, 60_000);
    assert.equal(await queue.renewProviderSlot({ ...lease, token: 'stale' }), false);
    assert.equal(await queue.renewProviderSlot(lease), true);
    await queue.releaseProviderSlot({ ...lease, token: 'stale' });
    assert.equal(await queue.renewProviderSlot(lease), true);
    await queue.releaseProviderSlot(lease);
  });
});
