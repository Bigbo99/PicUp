import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, it, type TestContext } from 'node:test';
import type { ImageJobRecord } from '@picup/shared';
import { JobsService } from '../modules/jobs/jobs.service';
import { ObjectStorageService } from './object-storage.service';

const envNames = ['STORAGE_DRIVER', 'STORAGE_DIR', 'QINIU_PUBLIC_BASE_URL', 'OBJECT_CACHE_MAX_FILES', 'OBJECT_CACHE_MAX_BYTES', 'OBJECT_CACHE_TTL_SECONDS'] as const;
let originalEnv: Record<string, string | undefined>;
let directory: string;
const base = 'https://media.example.test';
const url = (name: string) => `${base}/outputs/${name}.png`;
const cachePath = (value: string) => join(directory, 'cache', 'objects', createHash('sha256').update(value).digest('hex'));

beforeEach(async () => {
  originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  directory = await mkdtemp(join(tmpdir(), 'picup-object-cache-'));
  Object.assign(process.env, {
    STORAGE_DRIVER: 'qiniu', STORAGE_DIR: directory, QINIU_PUBLIC_BASE_URL: base,
    OBJECT_CACHE_MAX_FILES: '1000', OBJECT_CACHE_MAX_BYTES: '1073741824', OBJECT_CACHE_TTL_SECONDS: '604800'
  });
});

afterEach(async () => {
  for (const name of envNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  const child = relative(resolve(tmpdir()), resolve(directory));
  assert.ok(child.startsWith('picup-object-cache-') && !child.includes('..'));
  await rm(directory, { recursive: true, force: true });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Transport = { requestQiniu(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Buffer): Promise<Buffer> };
function cloud(t: TestContext, service: ObjectStorageService, objects = new Map<string, Buffer>()) {
  const calls: Array<{ method: string; key: string }> = [];
  t.mock.method(service as unknown as Transport, 'requestQiniu', async (method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Buffer) => {
    calls.push({ method, key });
    if (method === 'PUT') { objects.set(key, Buffer.from(body!)); return Buffer.alloc(0); }
    if (method === 'DELETE') { objects.delete(key); return Buffer.alloc(0); }
    const result = objects.get(key);
    if (!result) throw new Error('Qiniu GET failed: 404');
    return Buffer.from(result);
  });
  return { objects, calls };
}

async function age(value: string, milliseconds: number) {
  const date = new Date(Date.now() - milliseconds);
  await utimes(cachePath(value), date, date);
}

it('warms the shared cache after uploading, including the first preview in a different service instance', async t => {
  const worker = new ObjectStorageService();
  const remote = cloud(t, worker);
  const value = Buffer.from('complete generated image');
  const saved = await worker.save('outputs', 'new.png', value, 'image/png');
  assert.equal(saved, url('new'));
  const api = new ObjectStorageService();
  const reader = cloud(t, api, remote.objects);
  assert.deepEqual(await api.readByUrl(saved), value);
  assert.deepEqual(await api.readByUrl(`${saved}?token=changed`), value);
  assert.deepEqual(remote.calls.map(call => call.method), ['PUT']);
  assert.equal(reader.calls.length, 0);
});

it('coalesces simultaneous cold reads and caches the result for later requests', async t => {
  const service = new ObjectStorageService();
  const response = deferred<Buffer>();
  const started = deferred<void>();
  let reads = 0;
  t.mock.method(service as unknown as Transport, 'requestQiniu', async () => {
    reads++; started.resolve(); return response.promise;
  });
  const pending = Array.from({ length: 20 }, () => service.readByUrl(url('cold')));
  await started.promise;
  response.resolve(Buffer.from('image'));
  const results = await Promise.all(pending);
  assert.ok(results.every(value => value.equals(Buffer.from('image'))));
  assert.equal(reads, 1);
  await service.readByUrl(url('cold'));
  assert.equal(reads, 1);
});

it('retries a failed cold read instead of retaining its rejected promise', async t => {
  const service = new ObjectStorageService();
  const remote = cloud(t, service);
  await assert.rejects(service.readByUrl(url('missing')), /404/);
  remote.objects.set('outputs/missing.png', Buffer.from('available now'));
  assert.equal((await service.readByUrl(url('missing'))).toString(), 'available now');
  assert.equal(remote.calls.length, 2);
});

it('evicts the least recently used image rather than the oldest uploaded image', async t => {
  process.env.OBJECT_CACHE_MAX_FILES = '2';
  const service = new ObjectStorageService();
  cloud(t, service);
  await service.save('outputs', 'first.png', Buffer.from('first'), 'image/png');
  await service.save('outputs', 'second.png', Buffer.from('second'), 'image/png');
  await age(url('first'), 20_000);
  await age(url('second'), 10_000);
  await service.readByUrl(url('first'));
  await service.save('outputs', 'third.png', Buffer.from('third'), 'image/png');
  assert.equal((await readFile(cachePath(url('first')))).toString(), 'first');
  await assert.rejects(stat(cachePath(url('second'))), { code: 'ENOENT' });
  assert.equal((await readdir(join(directory, 'cache', 'objects'))).length, 2);
});

it('enforces the byte budget independently of image count and skips oversized objects', async t => {
  process.env.OBJECT_CACHE_MAX_BYTES = '8';
  const service = new ObjectStorageService();
  cloud(t, service);
  await service.save('outputs', 'first.png', Buffer.alloc(5), 'image/png');
  await age(url('first'), 10_000);
  await service.save('outputs', 'second.png', Buffer.alloc(5), 'image/png');
  await assert.rejects(stat(cachePath(url('first'))), { code: 'ENOENT' });
  await service.save('outputs', 'large.png', Buffer.alloc(9), 'image/png');
  await assert.rejects(stat(cachePath(url('large'))), { code: 'ENOENT' });
  assert.equal((await stat(cachePath(url('second')))).size, 5);
});

it('refreshes idle expiration on use and re-fetches expired images', async t => {
  process.env.OBJECT_CACHE_TTL_SECONDS = '60';
  const service = new ObjectStorageService();
  const remote = cloud(t, service);
  await service.save('outputs', 'image.png', Buffer.from('original'), 'image/png');
  await age(url('image'), 30_000);
  await service.readByUrl(url('image'));
  assert.ok(Date.now() - (await stat(cachePath(url('image')))).mtimeMs < 5000);
  await age(url('image'), 61_000);
  remote.objects.set('outputs/image.png', Buffer.from('fresh'));
  assert.equal((await service.readByUrl(url('image'))).toString(), 'fresh');
  assert.equal(remote.calls.filter(call => call.method === 'GET').length, 1);
});

it('does not expose or cache an upload before Qiniu confirms success', async t => {
  const service = new ObjectStorageService();
  const upload = deferred<Buffer>();
  const started = deferred<void>();
  t.mock.method(service as unknown as Transport, 'requestQiniu', async () => {
    started.resolve(); return upload.promise;
  });
  let finished = false;
  const saving = service.save('outputs', 'pending.png', Buffer.from('image'), 'image/png').then(value => { finished = true; return value; });
  await started.promise;
  assert.equal(finished, false);
  await assert.rejects(stat(cachePath(url('pending'))), { code: 'ENOENT' });
  upload.resolve(Buffer.alloc(0));
  assert.equal(await saving, url('pending'));
  assert.equal((await readFile(cachePath(url('pending')))).toString(), 'image');
});

it('keeps the confirmed cached object when an overwrite fails', async t => {
  const service = new ObjectStorageService();
  const remote = cloud(t, service);
  await service.save('outputs', 'image.png', Buffer.from('old'), 'image/png');
  t.mock.method(service as unknown as Transport, 'requestQiniu', async () => { throw new Error('upload failed'); });
  await assert.rejects(service.save('outputs', 'image.png', Buffer.from('new'), 'image/png'), /upload failed/);
  assert.equal((await service.readByUrl(url('image'))).toString(), 'old');
  assert.equal(remote.objects.get('outputs/image.png')!.toString(), 'old');
});

it('serializes deletion behind an in-flight download and removes its cached result', async t => {
  const service = new ObjectStorageService();
  const download = deferred<Buffer>();
  const started = deferred<void>();
  let deleted = false;
  t.mock.method(service as unknown as Transport, 'requestQiniu', async (method: 'GET' | 'PUT' | 'DELETE') => {
    if (method === 'DELETE') { deleted = true; return Buffer.alloc(0); }
    if (deleted) throw new Error('Qiniu GET failed: 404');
    started.resolve(); return download.promise;
  });
  const reading = service.readByUrl(url('image'));
  await started.promise;
  const deleting = service.deleteByUrl(url('image'));
  download.resolve(Buffer.from('old'));
  await Promise.all([reading, deleting]);
  await assert.rejects(stat(cachePath(url('image'))), { code: 'ENOENT' });
  await assert.rejects(service.readByUrl(url('image')), /404/);
});

it('serves Qiniu bytes even when the cache directory cannot be written', async t => {
  const service = new ObjectStorageService();
  const remote = cloud(t, service);
  t.mock.method(console, 'warn', () => {});
  await writeFile(join(directory, 'cache'), 'blocks the cache directory');
  const saved = await service.save('outputs', 'image.png', Buffer.from('image'), 'image/png');
  assert.equal((await service.readByUrl(saved)).toString(), 'image');
  assert.deepEqual(remote.calls.map(call => call.method), ['PUT', 'GET']);
});

it('can disable the cache and continues to support legacy local images', async t => {
  process.env.OBJECT_CACHE_MAX_FILES = '0';
  const service = new ObjectStorageService();
  const remote = cloud(t, service);
  const saved = await service.save('outputs', 'image.png', Buffer.from('remote'), 'image/png');
  await service.readByUrl(saved);
  await service.readByUrl(saved);
  assert.deepEqual(remote.calls.map(call => call.method), ['PUT', 'GET', 'GET']);
  await mkdir(join(directory, 'outputs'), { recursive: true });
  await writeFile(join(directory, 'outputs', 'legacy.png'), 'local');
  assert.equal((await service.readByUrl('/media/outputs/legacy.png')).toString(), 'local');
});

it('keeps the cache bounded after a burst of writes and leaves no partial files', async t => {
  process.env.OBJECT_CACHE_MAX_FILES = '4';
  process.env.OBJECT_CACHE_MAX_BYTES = '12';
  const service = new ObjectStorageService();
  cloud(t, service);
  await Promise.all(Array.from({ length: 20 }, (_, i) => service.save('outputs', `${i}.png`, Buffer.alloc(4, i), 'image/png')));
  const names = await readdir(join(directory, 'cache', 'objects'));
  assert.ok(names.length <= 3);
  assert.ok(names.every(name => /^[a-f0-9]{64}$/.test(name)));
  const lengths = await Promise.all(names.map(async name => (await stat(join(directory, 'cache', 'objects', name))).size));
  assert.ok(lengths.reduce((sum, size) => sum + size, 0) <= 12);
});

it('keeps the job running until upload finishes, then serves its confirmed result from cache', async t => {
  const objects = new ObjectStorageService();
  const upload = deferred<Buffer>();
  const started = deferred<void>();
  let remoteReads = 0;
  t.mock.method(objects as unknown as Transport, 'requestQiniu', async (method: 'GET' | 'PUT' | 'DELETE') => {
    if (method === 'PUT') { started.resolve(); return upload.promise; }
    remoteReads++;
    throw new Error('The result should already be cached');
  });
  let job = {
    id: 'delivery', userId: 'owner', status: 'queued', selectedProvider: 'mock', selectedModel: 'mock',
    inputFiles: [], outputImages: [], textOutputs: [], finalPrompt: 'generate', quality: '1K', aspectRatio: 'auto'
  } as unknown as ImageJobRecord;
  const storage = {
    getJob: async () => job,
    claimJob: async () => (job = { ...job, status: 'running', leaseOwner: 'lease' }),
    renewJobLease: async () => true,
    completeJob: async (value: ImageJobRecord) => (job = value),
    failJob: async () => { throw new Error('Unexpected generation failure'); }
  };
  const provider = { generate: async () => {
    const saved = await objects.save('outputs', 'delivery.png', Buffer.from('image bytes'), 'image/png');
    return { images: [{ url: saved, mimeType: 'image/png' }], textOutputs: [] };
  } };
  const queue = { acquireProviderSlot: async () => undefined, ackJob: async () => {} };
  const jobs = new JobsService({} as never, storage as never, queue as never, {} as never,
    { get: () => provider } as never, objects, {} as never, { getProvider: () => ({ id: 'mock' }) } as never);
  const processing = jobs.process(job.id);
  await started.promise;
  assert.equal((await jobs.get(job.id)).status, 'running');
  assert.deepEqual((await jobs.get(job.id)).outputImages, []);
  upload.resolve(Buffer.alloc(0));
  await processing;
  const completed = await jobs.get(job.id);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.outputImages[0].url, url('delivery'));
  const preview = await jobs.downloadOutput(job.id, 0, { id: 'owner' } as never);
  assert.equal(preview.body.toString(), 'image bytes');
  assert.equal(remoteReads, 0);
});
