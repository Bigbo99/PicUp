import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { AiConfigService } from '../../common/ai-config/ai-config.service';
import { preparePreview, previewInstructions, publicJob } from './preview-edit';
import { JobsService } from './jobs.service';
import { StorageService } from '../../common/storage.service';
import { PrismaService } from '../../common/database/prisma.service';
import { StudioController } from './studio.controller';
import { FilesService } from '../files/files.service';
import type { ImageJobCreateRequest, ImageJobRecord } from '@picup/shared';

const base: ImageJobCreateRequest = { mode: 'edit', provider: 'ignored', model: 'ignored', template: 'freeform', prompt: '改成绿色', imageIds: ['source'], previewOperation: 'describe', quality: '1K', aspectRatio: 'auto', paymentMode: 'credits' };
const provider = (id: string, type: string, model: string, priority: number) => ({ id, type, enabled: true, apiKey: 'test', models: [{ model, enabled: true, priority, costCredits: 4, maxInputImages: 2, supportedRatios: ['auto', '16:9'], supportedQualities: ['1K'] }] });
const ai = new AiConfigService();
ai.getConfig = () => ({ mockEnabled: false, providers: [provider('gemini', 'gemini-official', 'nano', 1), provider('images', 'openai-images', 'gpt-image-2', 2)] }) as never;

it('automatically chooses a capable model independently of the composer selection', () => {
  assert.equal(ai.resolveSelection(base).provider.id, 'gemini');
  assert.equal(ai.resolveSelection({ ...base, previewOperation: 'background' }).provider.id, 'images');
  assert.equal(ai.resolveSelection({ ...base, maskFileId: 'mask' }).provider.id, 'images');
  assert.throws(() => ai.resolveSelection({ ...base, aspectRatio: 'unsupported' }), /没有可执行/);
});
it('quotes background removal at one credit without changing other edit prices', async () => {
  const storage = { hasEnoughCredits: async (_id: string, credits: number) => credits <= 1 };
  const jobs = new JobsService({} as never, storage as never, {} as never, ai as never, {} as never, {} as never, {} as never, ai);
  const owner = { id: 'owner', role: 'user', isGuest: false } as never;
  const quote = await jobs.quote({ ...base, previewOperation: 'background', prompt: '' }, owner);
  assert.equal(quote.credits, 1);
  assert.equal(quote.available, true);
  const other = await jobs.quote(base, owner);
  assert.equal(other.credits, 4);
  assert.equal(other.available, false);
});
it('separates user instructions from system guidance and position comments', () => {
  const input = preparePreview({ ...base, previewOperation: 'resize', aspectRatio: '16:9', guideFileId: 'guide', editComments: [{ x: 40, y: 50, text: '白色文字' }] });
  assert.equal(input.prompt, '改成绿色');
  assert.equal(input.model, 'auto');
  const final = previewInstructions(input);
  assert.match(final, /16:9/); assert.match(final, /第二张仅为标记指引/); assert.match(final, /40.0%/);
  assert.equal(preparePreview({ ...base, prompt: '', previewOperation: 'background' }).prompt, '去除背景');
});
it('constrains removal to its mask and distinguishes transparent and opaque backgrounds', () => {
  const final = previewInstructions({ ...base, previewOperation: 'remove', maskFileId: 'mask', background: 'transparent' });
  assert.match(final, /alpha=0/);
  assert.match(final, /选区外完全不变/);
  assert.match(final, /不透明的白底仍是白底/);
  assert.match(final, /background=transparent/);
  assert.match(final, /保持原画布尺寸/);
});
it('removes all internal assets, instructions and diagnostic echoes from user responses', () => {
  const record = { ...base, inputFiles: [{ id: 'source' }, { id: 'guide', purpose: 'system' }], systemFileIds: ['source', 'guide'], guideFileId: 'guide', maskFileId: 'mask', maskFile: { url: 'private-mask' }, finalPrompt: 'private-instructions', editComments: [{ text: 'private-position' }], error: { code: 'PROVIDER', message: 'private-instructions' }, textOutputs: ['private-instructions'], outputImages: [{ url: 'result' }] } as ImageJobRecord;
  const visible = publicJob(record);
  assert.deepEqual(visible.inputFiles, []); assert.deepEqual(visible.imageIds, []);
  assert.equal(visible.prompt, base.prompt); assert.equal(visible.outputImages[0].url, 'result');
  assert.doesNotMatch(JSON.stringify(visible), /private-|guideFileId|maskFileId|systemFileIds|editComments/);
  assert.equal(record.inputFiles.length, 2);
});
it('refuses access to internal files even for the owning user', async () => {
  const files = new FilesService({ getFiles: async () => [{ purpose: 'system' }] } as never, {} as never);
  await assert.rejects(files.readForUser('11111111-1111-4111-8111-111111111111', { id: 'owner' } as never), /Image not found/);
});
it('requires current quote confirmation, persists admin evidence and hides it from the gallery', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const db = new PrismaService({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const user = await db.user.create({ data: { role: 'user', isGuest: false, creditBalance: 20 } });
  try {
    const source = await db.fileRecord.create({ data: { userId: user.id, url: '/preview-source.png', mimeType: 'image/png', size: 10 } });
    const guide = await db.fileRecord.create({ data: { userId: user.id, purpose: 'system', url: '/preview-guide.png', mimeType: 'image/png', size: 10 } });
    const storage = new StorageService(db);
    const jobs = new JobsService(db, storage, { enqueueJob: async () => {} } as never, ai as never, {} as never, {} as never, {} as never, ai);
    const owner = { id: user.id, role: 'user', isGuest: false } as never;
    const request = { ...base, imageIds: [source.id], guideFileId: guide.id };
    const quote = await jobs.quote(request, owner);
    assert.equal(quote.credits, 4); assert.equal(quote.selection, 'gemini:nano');
    await assert.rejects(jobs.create(request, owner), /重新确认/);
    await assert.rejects(jobs.create({ ...request, confirmedCredits: 3, quotedSelection: quote.selection }, owner), /重新确认/);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).creditBalance, 20);
    const input = { ...request, confirmedCredits: quote.credits, quotedSelection: quote.selection, idempotencyKey: 'confirmed-preview-job' };
    const result = await jobs.create(input, owner);
    assert.equal((await jobs.create(input, owner)).jobId, result.jobId);
    const saved = (await storage.getJob(result.jobId!, user.id))!;
    assert.equal(saved.prompt, '改成绿色'); assert.match(saved.finalPrompt, /第二张仅为标记指引/);
    assert.equal(saved.guideFileId, guide.id); assert.equal(saved.confirmedCredits, 4);
    assert.equal(saved.inputFiles.length, 2); assert.equal(publicJob(saved).inputFiles.length, 0);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).creditBalance, 16);
    await db.imageJob.update({ where: { id: result.jobId }, data: { status: 'succeeded', outputImages: [{ url: '/result.png', mimeType: 'image/png' }] } });
    const assets = await new StudioController(db).listAssets({ authUser: owner } as never);
    assert.equal(assets.items.length, 1); assert.equal(assets.items[0].kind, 'generated'); assert.equal(assets.items[0].title, '改成绿色');
  } finally {
    await db.imageJob.deleteMany({ where: { userId: user.id } }); await db.fileRecord.deleteMany({ where: { userId: user.id } }); await db.user.delete({ where: { id: user.id } }); await db.$disconnect();
  }
});
