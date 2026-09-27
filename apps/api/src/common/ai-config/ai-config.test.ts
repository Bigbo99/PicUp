import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, it } from 'node:test';
import { AiConfigService } from './ai-config.service';
import type { AiConfigDocument, AiProviderConfig } from './ai-config.types';

let directory: string;
let configPath: string;
let oldPath: string | undefined;
let service: AiConfigService;
let config: AiConfigDocument;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'picup-routing-test-'));
  configPath = join(directory, 'ai-config.json');
  oldPath = process.env.AI_CONFIG_PATH;
  process.env.AI_CONFIG_PATH = configPath;
  const provider = (id: string, fallbackOnly = false): AiProviderConfig => ({
    id, type: 'openai-images', displayName: id, enabled: true, fallbackOnly, apiKey: '',
    baseUrl: 'https://example.test', paths: { generations: '/generate', edits: '/edit' },
    aliases: [`${id}-alias`], defaultModel: 'image', timeoutMs: 60_000,
    models: [{ model: 'image', displayName: 'Image', description: '', enabled: true,
      maxInputImages: 4, supportedRatios: ['auto'], supportedQualities: ['1K'], costCredits: 1 }]
  });
  config = { version: 1, mockEnabled: true,
    routing: { default: { provider: 'primary', model: 'image' }, professional: { provider: 'primary', model: 'image' } },
    providers: [provider('primary'), provider('backup', true)] };
  writeFileSync(configPath, JSON.stringify(config));
  service = new AiConfigService();
});

afterEach(() => {
  if (oldPath === undefined) delete process.env.AI_CONFIG_PATH;
  else process.env.AI_CONFIG_PATH = oldPath;
  assert.ok(relative(tmpdir(), directory).startsWith('picup-routing-test-'));
  rmSync(directory, { recursive: true, force: true });
});

it('rejects a fallback-only default or professional route, including provider aliases', () => {
  const original = readFileSync(configPath, 'utf8');
  for (const route of ['default', 'professional'] as const) {
    for (const provider of ['backup', 'backup-alias']) {
      assert.throws(() => service.updateRouting({ ...config.routing, [route]: { provider, model: 'image' } }), /仅备用/);
      assert.equal(readFileSync(configPath, 'utf8'), original);
    }
  }
});

it('rejects changing an active default provider to fallback-only without altering the saved config', () => {
  const original = readFileSync(configPath, 'utf8');
  assert.throws(() => service.updateProvider('primary', { fallbackOnly: true }), /仅备用/);
  assert.equal(readFileSync(configPath, 'utf8'), original);
  assert.equal(service.getProvider('primary').fallbackOnly, false);
});

it('rejects invalid fallback-only routing when loading a hand-edited config', () => {
  config.routing.professional.provider = 'backup';
  writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => service.getConfig(), /仅备用/);
});

it('keeps enabled backup providers usable for failover but out of the model catalog', () => {
  assert.equal(service.getProvider('backup').id, 'backup');
  assert.ok(service.getModelsResponse().models.every(model => model.provider !== 'backup'));
  service.updateProvider('backup', { fallbackOnly: false });
  const routing = service.updateRouting({ default: { provider: 'backup', model: 'image' }, professional: config.routing.professional });
  assert.equal(routing.default.provider, 'backup');
});
