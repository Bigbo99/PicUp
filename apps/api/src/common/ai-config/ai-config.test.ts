import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, it, mock } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { UpdateAiModelDto } from '../../modules/admin/dto';
import { IMAGE_MODEL_PRESETS, customImageSize, imageModelPreset, tokenRunSizeFor } from '@picup/shared';
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
  mock.restoreAll();
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

it('preserves model capabilities when a transformed partial DTO toggles enabled', () => {
  const before = service.getConfig().providers[1].models[0];
  const input = plainToInstance(UpdateAiModelDto, { enabled: false });
  // Optional DTO properties exist with undefined after class transformation.
  input.supportedRatios = undefined;
  input.supportedQualities = undefined;
  input.maxInputImages = undefined;
  const result = service.updateModel('backup', 'image', input);
  assert.deepEqual(result, { ...before, enabled: false });
  const disk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(disk.providers[1].models[0], result);
});

it('rejects an explicitly invalid capability patch without changing disk or cached state', () => {
  const before = readFileSync(configPath, 'utf8');
  assert.throws(() => service.updateModel('backup', 'image', { supportedRatios: null as never }), /比例/);
  assert.equal(readFileSync(configPath, 'utf8'), before);
  assert.deepEqual(service.getConfig().providers[1].models[0].supportedRatios, ['auto']);
});

function configureDiscovery() {
  config.providers[1].baseUrl = 'https://93.184.216.34/v1';
  config.providers[1].apiKey = 'test-key';
  writeFileSync(configPath, JSON.stringify(config));
}

function remoteModels(ids: string[]) {
  return Response.json({ data: ids.map(id => ({ id })) });
}

it('discovers only image candidates without writing config or exposing credentials', async () => {
  configureDiscovery();
  const before = readFileSync(configPath, 'utf8');
  mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://93.184.216.34/v1/models');
    assert.equal(init.redirect, 'error');
    return remoteModels(['gpt-image-2', 'gpt-image-2', 'text-model', 'unknown-image-model']);
  });
  const result = await service.availableModels('backup');
  assert.equal(result.omitted, 1);
  assert.equal(result.models.filter(item => item.model === 'gpt-image-2').length, 1);
  assert.ok(result.models.find(item => item.model === 'gpt-image-2')?.defaults);
  assert.equal(result.models.find(item => item.model === 'unknown-image-model')?.defaults, undefined);
  assert.equal(JSON.stringify(result).includes('test-key'), false);
  assert.equal(readFileSync(configPath, 'utf8'), before);
});

it('installs only selected known models and preserves unrelated model settings', async () => {
  configureDiscovery();
  mock.method(globalThis, 'fetch', async () => remoteModels(['gpt-image-2', 'gpt-image-2.5-flare']));
  const before = service.getConfig().providers[1].models[0];
  assert.deepEqual(await service.installModels('backup', ['gpt-image-2']), { installed: 1 });
  const models = service.getConfig().providers[1].models;
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], before);
  assert.deepEqual(models[1].supportedQualities, ['1K', '2K', '4K']);
  assert.equal(models[1].enabled, true);
});

it('retains relay restrictions, price, enablement and upstream aliases when applying a preset', async () => {
  configureDiscovery();
  const existing = { ...config.providers[1].models[0], model: 'gpt-image-2', upstreamModel: 'custom-image',
    supportedRatios: ['1:1'], supportedQualities: ['1K', '2K'] as const, maxInputImages: 0, costCredits: 7, enabled: false };
  config.providers[1].models.push({ ...existing, supportedQualities: [...existing.supportedQualities] });
  writeFileSync(configPath, JSON.stringify(config));
  mock.method(globalThis, 'fetch', async () => remoteModels(['gpt-image-2']));
  await service.installModels('backup', ['gpt-image-2']);
  assert.deepEqual(service.getConfig().providers[1].models[1], { ...existing, supportedQualities: [...existing.supportedQualities] });
});

it('rejects missing or unknown selections atomically', async () => {
  configureDiscovery();
  const before = readFileSync(configPath, 'utf8');
  mock.method(globalThis, 'fetch', async () => remoteModels(['gpt-image-2', 'unknown-image']));
  for (const selected of [['gpt-image-2', 'unknown-image'], ['gpt-image-2.5-flare'], [], ['gpt-image-2', 'gpt-image-2']]) {
    await assert.rejects(service.installModels('backup', selected));
    assert.equal(readFileSync(configPath, 'utf8'), before);
  }
});

it('does not broaden limits on a previously synced model', async () => {
  configureDiscovery();
  config.providers[1].models.push({ ...config.providers[1].models[0], model: 'gpt-image-2',
    description: '从 OpenAI 兼容中转站同步', supportedQualities: ['1K', '2K'] });
  writeFileSync(configPath, JSON.stringify(config));
  mock.method(globalThis, 'fetch', async () => remoteModels(['gpt-image-2']));
  await service.installModels('backup', ['gpt-image-2']);
  assert.deepEqual(service.getConfig().providers[1].models[1].supportedQualities, ['1K', '2K']);
});

it('rejects stale discovery when the connection changes during the request', async () => {
  configureDiscovery();
  mock.method(globalThis, 'fetch', async () => {
    service.updateProvider('backup', { displayName: 'Edited during discovery' });
    return remoteModels(['gpt-image-2']);
  });
  await assert.rejects(service.installModels('backup', ['gpt-image-2']), /配置已变化/);
  assert.equal(service.getConfig().providers[1].displayName, 'Edited during discovery');
  assert.equal(service.getConfig().providers[1].models.length, 1);
});

it('does not install models after a malformed or failed remote response', async () => {
  configureDiscovery();
  const before = readFileSync(configPath, 'utf8');
  mock.method(globalThis, 'fetch', async () => Response.json({ data: {} }));
  await assert.rejects(service.installModels('backup', ['gpt-image-2']), /格式/);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response('unauthorized', { status: 401 }));
  await assert.rejects(service.installModels('backup', ['gpt-image-2']), /HTTP 401/);
  assert.equal(readFileSync(configPath, 'utf8'), before);
});

it('keeps legacy sync limited to known presets, disabled by default', async () => {
  configureDiscovery();
  mock.method(globalThis, 'fetch', async () => remoteModels(['gpt-image-2', 'text-model', 'unknown-image']));
  const result = await service.syncModels('backup');
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.models[1].enabled, false);
});

it('exposes documented GrsAI presets without pretending the key was verified', async () => {
  config.providers[1].type = 'grsai';
  config.providers[1].paths = { generate: '/v1/draw/nano-banana', result: '/v1/draw/result' };
  writeFileSync(configPath, JSON.stringify(config));
  const result = await service.availableModels('backup');
  assert.equal(result.source, 'configured');
  assert.ok(result.models.some(item => item.model === 'nano-banana-2' && item.defaults));
  assert.ok(result.models.every(item => !item.listed));
});

it('generates valid OpenAI pixel sizes for every advertised preset combination', () => {
  for (const preset of IMAGE_MODEL_PRESETS.filter(item => item.protocols.includes('openai-images'))) {
    for (const ratio of preset.ratios.filter(value => value !== 'auto')) {
      for (const resolution of preset.resolutions) {
        const [width, height] = tokenRunSizeFor(ratio, resolution).split('x').map(Number);
        assert.doesNotThrow(() => customImageSize(width, height), preset.model + ' ' + ratio + ' ' + resolution);
      }
    }
  }
  assert.equal(imageModelPreset('openai-images', 'gpt-image-2-unknown-relay-alias'), undefined);
  assert.equal(imageModelPreset('gemini-official', 'gemini-3.1-flash-image-preview')?.model, 'gemini-3.1-flash-image');
});
