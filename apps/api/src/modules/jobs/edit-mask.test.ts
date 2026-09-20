import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import sharp from 'sharp';
import { compositeRemoval, hasTransparency, validateEditMask } from './edit-mask';
import { JobsService } from './jobs.service';
import { TokenRunProvider } from '../providers/tokenrun.provider';
import { PrismaService } from '../../common/database/prisma.service';
import { StorageService } from '../../common/storage.service';

const png = (width: number, alpha: number) => sharp({ create: { width, height: 4, channels: 4, background: { r: 255, g: 255, b: 255, alpha } } }).png().toBuffer();
const rgba = (pixels: number[]) => sharp(Buffer.from(pixels), { raw: { width: pixels.length / 4, height: 1, channels: 4 } }).png().toBuffer();

it('preserves unselected RGBA and existing transparency even when the model paints black', async () => {
  const original = await rgba([10, 20, 30, 255, 0, 0, 0, 0, 40, 50, 60, 128, 70, 80, 90, 255]);
  const mask = await rgba([255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0]);
  const black = await rgba([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const result = await compositeRemoval(original, mask, black);
  const actual = await sharp(result.body).raw().toBuffer();
  assert.deepEqual([...actual], [10, 20, 30, 255, 0, 0, 0, 0, 40, 50, 60, 128, 0, 0, 0, 255]);
  assert.equal(await hasTransparency(original), true);
});

it('does not mistake opaque white pixels or an opaque alpha channel for transparency', async () => {
  const original = await rgba([255, 255, 255, 255, 200, 100, 50, 255]);
  const mask = await rgba([255, 255, 255, 255, 255, 255, 255, 0]);
  const generated = await rgba([0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(await hasTransparency(original), false);
  const result = await compositeRemoval(original, mask, generated);
  assert.deepEqual([...await sharp(result.body).raw().toBuffer()], [255, 255, 255, 255, 255, 255, 255, 255]);
});

it('rejects incompatible output geometry and normalizes matching proportions to source dimensions', async () => {
  const original = await png(4, 1);
  const mask = await png(4, 0);
  await assert.rejects(compositeRemoval(original, mask, await png(3, 1)), /比例/);
  const larger = await sharp(original).resize(8, 8).png().toBuffer();
  const result = await compositeRemoval(original, mask, larger);
  assert.equal(result.width, 4);
  assert.equal(result.height, 4);
});

it('requests transparency for cutout removal and persists only the protected result', async () => {
  const original = await rgba([0, 0, 0, 0, 20, 30, 40, 255]);
  const mask = await rgba([255, 255, 255, 255, 255, 255, 255, 0]);
  const black = await rgba([0, 0, 0, 255, 0, 0, 0, 255]);
  const files = [
    { id: 'source', userId: 'owner', url: 'source', mimeType: 'image/png' },
    { id: 'mask', userId: 'owner', url: 'mask', mimeType: 'image/png' }
  ];
  const objects = new Map([['source', original], ['mask', mask], ['raw-output', black]]);
  let job: import('@picup/shared').ImageJobRecord;
  const storage = {
    getFiles: async (ids: string[]) => files.filter(file => ids.includes(file.id)),
    createJobWithReservation: async (value: typeof job) => { job = value; return { created: true, job }; },
    getJob: async () => job,
    claimJob: async () => (job = { ...job, status: 'running', leaseOwner: 'lease' }),
    renewJobLease: async () => true,
    completeJob: async (value: typeof job) => (job = value),
    failJob: async () => { throw new Error('Unexpected job failure'); }
  };
  const objectStorage = {
    readByUrl: async (url: string) => objects.get(url)!,
    save: async (_kind: string, name: string, body: Buffer) => { objects.set(name, body); return name; },
    deleteByUrl: async (url: string) => { objects.delete(url); }
  };
  const models = { resolveSelection: () => ({ provider: { id: 'images', type: 'openai-images' }, model: { model: 'gpt-image-1', maxInputImages: 1, supportedRatios: ['auto'], supportedQualities: ['1K'], costCredits: 1 } }) };
  const queue = { enqueueJob: async () => {}, acquireProviderSlot: async () => undefined, ackJob: async () => {} };
  const provider = { generate: async (input: { background?: string; prompt: string }) => {
    assert.equal(input.background, 'transparent');
    assert.match(input.prompt, /background=transparent/);
    return { images: [{ url: 'raw-output', mimeType: 'image/png' }], textOutputs: [] };
  } };
  const service = new JobsService({} as never, storage as never, queue as never, models as never,
    { get: () => provider } as never, objectStorage as never, {} as never,
    { getProvider: () => ({ id: 'images' }) } as never);
  const created = await service.create({ mode: 'edit', imageIds: ['source'], maskFileId: 'mask', prompt: '消除', previewOperation: 'remove', template: 'freeform', aspectRatio: 'auto', quality: '1K', model: 'auto', provider: 'auto', confirmedCredits: 0, quotedSelection: 'images:gpt-image-1' }, { id: 'owner', role: 'admin' } as never);
  const result = await service.process(created.jobId!);
  assert.equal(result?.status, 'succeeded');
  assert.equal(objects.has('raw-output'), false);
  assert.deepEqual([...await sharp(objects.get(result!.outputImages[0].url)!).raw().toBuffer()], [0, 0, 0, 0, 0, 0, 0, 255]);
});
it('accepts matching PNG masks and rejects empty, corrupt and mismatched selections', async () => {
  const original = await png(4, 1);
  await validateEditMask(original, await png(4, 0));
  await assert.rejects(validateEditMask(original, await png(3, 0)));
  await assert.rejects(validateEditMask(original, await png(4, 1)));
  await assert.rejects(validateEditMask(original, Buffer.from('not an image')));
});
it('rejects unsupported edit capabilities before reserving quota', async () => {
  let reserved = false;
  const service = new JobsService({} as never, { hasEnoughCredits: async () => { reserved = true; } } as never, {} as never,
    { resolveSelection: () => ({ provider: { id: 'gemini', type: 'gemini-official' }, model: { model: 'gemini', maxInputImages: 6, supportedRatios: ['auto'], supportedQualities: ['1K'], costCredits: 1 } }) } as never,
    {} as never, {} as never, {} as never, {} as never);
  await assert.rejects(service.quote({ mode: 'edit', imageIds: ['source'], prompt: 'remove background', template: 'freeform', background: 'transparent', aspectRatio: 'auto', quality: '1K', model: 'gemini', provider: 'gemini' }, { id: 'owner' } as never), /GPT Image/);
  assert.equal(reserved, false);
});
it('rejects another user mask before provider selection or payment', async () => {
  const service = new JobsService({} as never, { getFiles: async (ids: string[]) => [{ id: ids[0], userId: ids[0] === 'mask' ? 'other' : 'owner', mimeType: 'image/png' }] } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  await assert.rejects(service.create({ mode: 'edit', imageIds: ['source'], maskFileId: 'mask', prompt: 'remove', template: 'freeform', aspectRatio: 'auto', quality: '1K', model: 'gpt-image-1', provider: 'openai' }, { id: 'owner' } as never), /蒙版/);
});
it('sends mask separately from image references and requests real transparent output', async () => {
  const provider = new TokenRunProvider({ readByUrl: async () => png(4, 0), filenameFromUrl: () => 'source.png' } as never, {} as never);
  const form = await (provider as unknown as { buildEditRequest(input: unknown): Promise<FormData> }).buildEditRequest({ model: 'gpt-image-1', prompt: 'remove', aspectRatio: '1:1', quality: '1K', background: 'transparent', images: [{ url: 'source', mimeType: 'image/png' }], mask: { url: 'mask' } });
  assert.equal(form.getAll('image[]').length, 1);
  assert.equal((form.get('mask') as File).type, 'image/png');
  assert.equal(form.get('background'), 'transparent');
  assert.equal(form.get('output_format'), 'png');
});

it('preserves edit options across database reads and idempotent retries', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const db = new PrismaService({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const owner = await db.user.create({ data: { role: 'admin', isGuest: false } });
  try {
    const source = await db.fileRecord.create({ data: { userId: owner.id, url: '/edit-test-source.png', mimeType: 'image/png', size: 10 } });
    const mask = await db.fileRecord.create({ data: { userId: owner.id, url: '/edit-test-mask.png', mimeType: 'image/png', size: 10 } });
    const storage = new StorageService(db);
    const service = new JobsService(db, storage, { enqueueJob: async () => {} } as never,
      { resolveSelection: () => ({ provider: { id: 'test', type: 'openai-images' }, model: { model: 'gpt-image-1', maxInputImages: 1, supportedRatios: ['auto'], supportedQualities: ['1K'], costCredits: 0 } }) } as never,
      {} as never, { readByUrl: async (url: string) => png(4, url === mask.url ? 0 : 1) } as never, {} as never, {} as never);
    const input = { mode: 'edit' as const, provider: 'test', model: 'gpt-image-1', template: 'freeform' as const, prompt: 'remove background', imageIds: [source.id], maskFileId: mask.id, background: 'transparent' as const, quality: '1K' as const, aspectRatio: 'auto', idempotencyKey: 'preview-test-request' };
    const user = { id: owner.id, role: 'admin', isGuest: false } as never;
    const first = await service.create(input, user);
    assert.equal((await service.create(input, user)).jobId, first.jobId);
    const saved = await storage.getJob(first.jobId!, owner.id);
    assert.equal(saved?.maskFile?.id, mask.id);
    assert.equal(saved?.maskFileId, mask.id);
    assert.equal(saved?.background, 'transparent');
    assert.deepEqual(saved?.imageIds, [source.id]);
    assert.equal(saved?.inputFiles.length, 1);
  } finally {
    await db.imageJob.deleteMany({ where: { userId: owner.id } });
    await db.fileRecord.deleteMany({ where: { userId: owner.id } });
    await db.user.delete({ where: { id: owner.id } });
    await db.$disconnect();
  }
});
