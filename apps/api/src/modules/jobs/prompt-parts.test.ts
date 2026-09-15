import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { promptPartsText, type PromptPart } from '@picup/shared';
import { compilePromptParts } from './prompt-parts';
import { StudioController } from './studio.controller';
import { PrismaService } from '../../common/database/prisma.service';
import { StorageService } from '../../common/storage.service';
import { JobsService } from './jobs.service';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const c = '33333333-3333-4333-8333-333333333333';
it('orders images by inline appearance, reuses repeated images, and retains unmentioned attachments', () => {
  const promptParts: PromptPart[] = [{ type: 'image', fileId: b, label: '同名图片' }, { type: 'text', text: ' 放在 ' }, { type: 'image', fileId: a, label: '同名图片' }, { type: 'text', text: ' 中，保留 ' }, { type: 'image', fileId: b, label: '同名图片' }];
  const result = compilePromptParts({ prompt: promptPartsText(promptParts), promptParts, imageIds: [a, c, b] });
  assert.deepEqual(result.imageIds, [b, a, c]);
  assert.equal(result.prompt, '图片 1（同名图片） 放在 图片 2（同名图片） 中，保留 图片 1（同名图片）');
});
it('keeps literal @ and placeholder-like text unchanged in legacy requests', () => {
  assert.deepEqual(compilePromptParts({ prompt: '@test {{img:fake}}', imageIds: [a] }), { prompt: '@test {{img:fake}}', imageIds: [a] });
});
it('rejects removed images, mismatched text, malformed parts and forged attributes', () => {
  const part = { type: 'image', fileId: a, label: '主体' } as const;
  assert.throws(() => compilePromptParts({ prompt: '@主体', imageIds: [], promptParts: [part] }));
  assert.throws(() => compilePromptParts({ prompt: '不同描述', imageIds: [a], promptParts: [part] }));
  for (const invalid of [null, { type: 'other' }, { ...part, fileId: '../../secret' }, { ...part, subjectId: false }, { ...part, url: 'https://untrusted.test' }]) {
    assert.throws(() => compilePromptParts({ prompt: '@主体', imageIds: [a], promptParts: [invalid] as unknown as PromptPart[] }));
  }
});
it('does not create a subject from another account or from an unavailable image', async () => {
  let created = false;
  const controller = new StudioController({ fileRecord: { findFirst: async (query: { where: { userId: string } }) => { assert.equal(query.where.userId, 'owner'); return null; } }, studioSubject: { create: async () => { created = true; } } } as never);
  await assert.rejects(() => controller.createSubject({ name: '人物', fileId: a }, { authUser: { id: 'owner' } } as never));
  assert.equal(created, false);
});

it('persists subjects and ordered prompt parts, isolates accounts, and preserves history after subject deletion', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const db = new PrismaService({ datasourceUrl: process.env.TEST_DATABASE_URL });
  const owner = await db.user.create({ data: { role: 'admin', isGuest: false } });
  const other = await db.user.create({ data: { role: 'user', isGuest: false } });
  try {
    const first = await db.fileRecord.create({ data: { userId: owner.id, url: '/test-first.png', mimeType: 'image/png', size: 10 } });
    const second = await db.fileRecord.create({ data: { userId: owner.id, url: '/test-second.png', mimeType: 'image/png', size: 10 } });
    const studio = new StudioController(db);
    const req = { authUser: { id: owner.id } } as never;
    const foreign = { authUser: { id: other.id } } as never;
    const subject = await studio.createSubject({ name: '人物', description: '白色上衣', fileId: second.id }, req);
    assert.equal((await studio.subjects(req)).items[0].id, subject.id);
    assert.equal((await studio.subjects(foreign)).items.length, 0);
    assert.equal((await studio.listAssets(req, '', 'subject')).items[0].key, `subject:${subject.id}`);
    await assert.rejects(studio.createSubject({ name: '越权', fileId: second.id }, foreign));
    const storage = new StorageService(db);
    const jobs = new JobsService(db, storage, { enqueueJob: async () => {} } as never,
      { resolveSelection: () => ({ provider: { id: 'test' }, model: { model: 'test', maxInputImages: 6, supportedRatios: ['auto'], supportedQualities: ['1K'], costCredits: 0 } }) } as never,
      {} as never, {} as never, {} as never, {} as never);
    const parts: PromptPart[] = [{ type: 'image', fileId: second.id, label: '人物', subjectId: subject.id }, { type: 'text', text: ' 放到 ' }, { type: 'image', fileId: first.id, label: '背景' }];
    const input = { mode: 'edit' as const, provider: 'test', model: 'test', template: 'freeform' as const, prompt: promptPartsText(parts), promptParts: parts, imageIds: [first.id, second.id], quality: '1K' as const, aspectRatio: 'auto' };
    const response = await jobs.create(input, { id: owner.id, role: 'admin', isGuest: false } as never);
    const saved = await storage.getJob(response.jobId!, owner.id);
    assert.deepEqual(saved?.promptParts, parts);
    assert.deepEqual(saved?.inputFiles.map(file => file.id), [second.id, first.id]);
    assert.match(saved!.finalPrompt, /图片 1（人物） 放到 图片 2（背景）/);
    assert.match(saved!.finalPrompt, /图片 1 的主体描述：白色上衣/);
    await assert.rejects(jobs.create(input, { id: other.id, role: 'admin', isGuest: false } as never));
    await studio.updateAsset(`subject:${subject.id}`, { hidden: true }, req);
    assert.equal((await studio.subjects(req)).items.length, 0);
    assert.deepEqual((await storage.getJob(response.jobId!, owner.id))?.promptParts, parts);
  } finally {
    await db.imageJob.deleteMany({ where: { userId: owner.id } });
    await db.studioSubject.deleteMany({ where: { userId: owner.id } });
    await db.fileRecord.deleteMany({ where: { userId: owner.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    await db.$disconnect();
  }
});
