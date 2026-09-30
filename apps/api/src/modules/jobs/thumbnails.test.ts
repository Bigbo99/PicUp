import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { it } from 'node:test';
import sharp from 'sharp';
import { FilesController } from '../files/files.controller';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

it('serves actual small WebP bytes for both thumbnail routes and keeps original bytes for full view', async () => {
  const original = await sharp(randomBytes(1200 * 800 * 3), { raw: { width: 1200, height: 800, channels: 3 } }).png().toBuffer();
  const file = { body: original, mimeType: 'image/png' };
  const files = new FilesController({ readForUser: async () => file } as never);
  const jobs = new JobsController({ downloadOutput: async () => file } as never, { requireUser: async () => ({ id: 'owner' }) } as never);
  const request = { authUser: { id: 'owner' } } as never;
  for (const kind of ['file', 'output']) {
    for (const variant of ['thumbnail', undefined]) {
      const headers = new Map<string, string>();
      let body: Buffer = Buffer.alloc(0);
      const response = { setHeader: (key: string, value: string) => headers.set(key, value), send: (value: Buffer) => { body = value; } } as never;
      if (kind === 'file') await files.content('file', variant, request, response);
      else await jobs.preview('job', '0', variant, request, response);
      if (variant) {
        const metadata = await sharp(body).metadata();
        assert.equal(headers.get('Content-Type'), 'image/webp');
        assert.equal(metadata.width, 360);
        assert.equal(metadata.height, 240);
        assert.ok(body.length < original.length / 10);
      } else assert.deepEqual(body, original);
    }
  }
});

it('returns only output fingerprints and checks ownership before reading any image', async () => {
  let reads = 0;
  const body = Buffer.from('original image bytes');
  const jobs = new JobsService({} as never, {
    getJob: async (_id: string, userId: string) => userId === 'owner' ? { outputImages: [{ url: 'stored-output' }] } : null
  } as never, {} as never, {} as never, {} as never, { readByUrl: async () => { reads++; return body; } } as never, {} as never, {} as never);
  await assert.rejects(() => jobs.outputHashes('job', { id: 'other' } as never));
  assert.equal(reads, 0);
  assert.deepEqual(await jobs.outputHashes('job', { id: 'owner' } as never), [createHash('sha256').update(body).digest('hex')]);
  assert.equal(reads, 1);
});
