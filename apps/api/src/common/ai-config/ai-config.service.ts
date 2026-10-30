import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type {
  AdminAiConfigResponse,
  AdminAiModelInput,
  AdminAiProviderInput,
  AdminAiModelSyncResult,
  AiProviderType,
  AiRoutingTarget,
  ImageJobCreateRequest,
  ImageQuality,
  ModelConfig,
  ModelsResponse
} from '@picup/shared';
import type { AiConfigDocument, AiProviderConfig } from './ai-config.types';
import { IMAGE_MODEL_PRESETS, imageModelDefaults, imageModelPreset, type AvailableImageModels } from '@picup/shared';
import { assertSafeExternalUrl, readLimitedResponse } from '../safe-external-fetch';

const providerTypes = new Set<AiProviderType>(['grsai', 'gemini-official', 'openai-images', 'openai-compatible']);
const idPattern = /^[a-z0-9][a-z0-9._-]*$/;
const professionalTemplates = new Set(['replace_text', 'poster_text', 'product']);

@Injectable()
export class AiConfigService {
  private cached?: AiConfigDocument;
  private cachedMtimeMs = -1;
  private warnedFallback = false;

  get path() {
    const configured = process.env.AI_CONFIG_PATH?.trim() || 'config/ai-config.json';
    if (isAbsolute(configured)) return configured;
    return resolve(process.env.PICUP_ROOT ?? process.cwd(), configured);
  }

  getConfig() {
    this.reloadIfChanged();
    return structuredClone(this.cached as AiConfigDocument);
  }

  getProvider(providerId: string, includeDisabled = false) {
    const config = this.getConfig();
    const provider = this.findProvider(config, providerId);
    if (!provider) throw new NotFoundException(`AI Provider 不存在：${providerId}`);
    if (!includeDisabled && !provider.enabled) {
      throw new BadRequestException(`AI Provider 已禁用：${provider.displayName}`);
    }
    return provider;
  }

  getModel(providerId: string, modelId: string, includeDisabled = false) {
    const provider = this.getProvider(providerId, includeDisabled);
    const model = this.findModel(provider, modelId);
    if (!model) throw new NotFoundException(`模型不存在：${provider.id}/${modelId}`);
    if (!includeDisabled && !model.enabled) {
      throw new BadRequestException(`模型已禁用：${model.displayName}`);
    }
    return { provider, model };
  }

  getModelsResponse(): ModelsResponse {
    const config = this.getConfig();
    const models = config.providers.filter(provider => !provider.fallbackOnly).flatMap((provider) => provider.models.map<ModelConfig>((model) => ({
      id: `${provider.id}:${model.model}`,
      provider: provider.id,
      providerDisplayName: provider.displayName,
      providerType: provider.type,
      supportsMask: provider.type === 'openai-images' && /^gpt-image-/i.test(model.upstreamModel ?? model.model),
      supportsTransparentBackground: provider.type === 'openai-images' && /^gpt-image-/i.test(model.upstreamModel ?? model.model),
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      enabled: provider.enabled && model.enabled,
      priority: model.priority,
      maxInputImages: model.maxInputImages,
      supportedRatios: [...model.supportedRatios],
      supportedQualities: [...model.supportedQualities],
      costCredits: model.costCredits
    })));

    return {
      models: models.sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100)),
      defaultProvider: 'auto',
      defaultModel: config.routing.default.model,
      source: 'runtime',
      routing: structuredClone(config.routing)
    };
  }

  resolveSelection(input: ImageJobCreateRequest) {
    const config = this.getConfig();
    if (input.previewOperation) {
      const checked = this.previewCandidates(input);
      const candidates = checked.filter(item => !item.reasons.length);
      if (!candidates.length) {
        console.warn(`[ai-config] 预览操作 ${input.previewOperation} 没有可用模型：${checked.map(item => `${item.provider.id}:${item.model.model}（${item.reasons.join('、')}）`).join('；') || '未配置任何模型'}`);
        throw new BadRequestException('当前没有可执行此操作的模型，请稍后重试');
      }
      return candidates[0];
    }
    const usesProfessionalRoute = input.quality === '4K'
      || professionalTemplates.has(input.template)
      || input.imageIds.length >= 4;
    const automaticTarget = usesProfessionalRoute ? config.routing.professional : config.routing.default;
    const requestedProvider = input.provider === 'auto' ? automaticTarget.provider : input.provider;
    const provider = this.findProvider(config, requestedProvider);
    if (!provider || !provider.enabled || provider.fallbackOnly) throw new BadRequestException('当前 AI Provider 不可用');

    const requestedModel = input.provider === 'auto'
      ? automaticTarget.model
      : input.model === 'auto'
        ? provider.defaultModel
        : input.model;
    const model = this.findModel(provider, requestedModel);
    if (!model || !model.enabled) throw new BadRequestException('当前模型不可用');

    return { provider, model };
  }

  // Preview edits bypass routing and pick the best model that can do the job. Every model is
  // returned with the reasons it cannot, so selection and diagnostics share one set of rules.
  previewCandidates(input: Pick<ImageJobCreateRequest, 'previewOperation' | 'maskFileId' | 'guideFileId' | 'imageIds' | 'aspectRatio' | 'quality'>) {
    const config = this.getConfig();
    const needsMask = Boolean(input.maskFileId);
    const needsTransparency = input.previewOperation === 'background';
    const count = input.imageIds.length + (input.guideFileId ? 1 : 0);
    const checked = config.providers.flatMap(provider => provider.models.map(model => {
      const reasons: string[] = [];
      if (!provider.enabled) reasons.push('服务商已停用');
      if (provider.fallbackOnly) reasons.push('服务商仅作备用');
      if (!config.mockEnabled && !provider.apiKey.trim()) reasons.push('服务商未配置 API Key');
      if (!model.enabled) reasons.push('模型已停用');
      if (model.maxInputImages < count) reasons.push(`最多 ${model.maxInputImages} 张输入图，需要 ${count} 张`);
      if (!model.supportedRatios.includes(input.aspectRatio)) reasons.push(`不支持比例 ${input.aspectRatio}`);
      if (!model.supportedQualities.includes(input.quality)) reasons.push(`不支持清晰度 ${input.quality}`);
      if ((needsMask || needsTransparency) && !(provider.type === 'openai-images' && /^gpt-image-/i.test(model.upstreamModel ?? model.model))) {
        reasons.push(needsMask ? '不支持蒙版编辑（需 openai-images 类型的 gpt-image 模型）' : '不支持透明背景（需 openai-images 类型的 gpt-image 模型）');
      }
      return { provider, model, reasons };
    }));
    return checked.sort((a, b) => (a.model.priority ?? 100) - (b.model.priority ?? 100) || a.model.costCredits - b.model.costCredits || `${a.provider.id}:${a.model.model}`.localeCompare(`${b.provider.id}:${b.model.model}`));
  }

  adminConfig(): AdminAiConfigResponse {
    const config = this.getConfig();
    return {
      version: config.version,
      path: this.path,
      mockEnabled: config.mockEnabled,
      routing: structuredClone(config.routing),
      providers: config.providers.map((provider) => ({
        id: provider.id,
        type: provider.type,
        displayName: provider.displayName,
        enabled: provider.enabled,
        apiKeyConfigured: Boolean(provider.apiKey.trim()),
        baseUrl: provider.baseUrl,
        paths: structuredClone(provider.paths),
        defaultModel: provider.defaultModel,
        aliases: provider.aliases ? [...provider.aliases] : undefined,
        fallbackProviderIds: provider.fallbackProviderIds ? [...provider.fallbackProviderIds] : undefined,
        fallbackOnly: provider.fallbackOnly,
        imageQuality: provider.imageQuality,
        imageResponseFormat: provider.imageResponseFormat,
        timeoutMs: provider.timeoutMs,
        concurrency: provider.concurrency ?? 4,
        rpm: provider.rpm ?? 0,
        retryAttempts: provider.retryAttempts,
        retryDelayMs: provider.retryDelayMs,
        pollIntervalMs: provider.pollIntervalMs,
        downloadRetryAttempts: provider.downloadRetryAttempts,
        disableProxy: provider.disableProxy,
        models: structuredClone(provider.models)
      }))
    };
  }

  providerHealth() {
    const config = this.getConfig();
    return {
      providers: config.providers.map((provider) => {
        const enabledModels = provider.models.filter((model) => model.enabled).length;
        const configured = config.mockEnabled || Boolean(provider.apiKey.trim());
        return {
          provider: provider.id,
          configured,
          enabledModels,
          lastCheckedAt: new Date().toISOString(),
          status: !provider.enabled
            ? 'disabled' as const
            : configured && enabledModels > 0
              ? 'healthy' as const
              : 'degraded' as const,
          message: !provider.enabled
            ? `${provider.displayName} 已禁用`
            : configured
              ? undefined
              : `${provider.displayName} API Key 未配置`
        };
      })
    };
  }

  createProvider(input: AdminAiProviderInput) {
    const config = this.getConfig();
    if (this.findProvider(config, input.id)) throw new ConflictException(`Provider 已存在：${input.id}`);
    const provider: AiProviderConfig = {
      id: input.id,
      type: input.type,
      displayName: input.displayName,
      enabled: input.enabled,
      aliases: input.aliases,
      fallbackProviderIds: input.fallbackProviderIds,
      fallbackOnly: input.fallbackOnly,
      imageQuality: input.imageQuality,
      imageResponseFormat: input.imageResponseFormat,
      apiKey: input.apiKey?.trim() ?? '',
      baseUrl: input.baseUrl,
      paths: input.paths,
      defaultModel: input.defaultModel,
      timeoutMs: input.timeoutMs ?? 600_000,
      concurrency: input.concurrency ?? 4,
      rpm: input.rpm ?? 0,
      retryAttempts: input.retryAttempts,
      retryDelayMs: input.retryDelayMs,
      pollIntervalMs: input.pollIntervalMs,
      downloadRetryAttempts: input.downloadRetryAttempts,
      proxyUrl: input.proxyUrl,
      downloadProxyUrl: input.downloadProxyUrl,
      disableProxy: input.disableProxy,
      models: []
    };
    config.providers.push(provider);
    this.save(config);
    return this.adminConfig().providers.find((item) => item.id === provider.id);
  }

  updateProvider(providerId: string, input: Partial<AdminAiProviderInput>) {
    const config = this.getConfig();
    const provider = this.requireProvider(config, providerId);
    if (input.id && input.id !== provider.id) throw new BadRequestException('Provider id 不支持修改');

    if (input.type !== undefined) provider.type = input.type;
    if (input.displayName !== undefined) provider.displayName = input.displayName;
    if (input.enabled !== undefined) provider.enabled = input.enabled;
    if (input.aliases !== undefined) provider.aliases = input.aliases;
    if (input.fallbackProviderIds !== undefined) provider.fallbackProviderIds = input.fallbackProviderIds;
    if (input.fallbackOnly !== undefined) provider.fallbackOnly = input.fallbackOnly;
    if (input.imageQuality !== undefined) provider.imageQuality = input.imageQuality;
    if (input.imageResponseFormat !== undefined) provider.imageResponseFormat = input.imageResponseFormat;
    if (input.apiKey?.trim()) provider.apiKey = input.apiKey.trim();
    if (input.clearApiKey) provider.apiKey = '';
    if (input.baseUrl !== undefined) provider.baseUrl = input.baseUrl;
    if (input.paths !== undefined) provider.paths = input.paths;
    if (input.defaultModel !== undefined) provider.defaultModel = input.defaultModel;
    if (input.timeoutMs !== undefined) provider.timeoutMs = input.timeoutMs;
    if (input.concurrency !== undefined) provider.concurrency = input.concurrency;
    if (input.rpm !== undefined) provider.rpm = input.rpm;
    if (input.retryAttempts !== undefined) provider.retryAttempts = input.retryAttempts;
    if (input.retryDelayMs !== undefined) provider.retryDelayMs = input.retryDelayMs;
    if (input.pollIntervalMs !== undefined) provider.pollIntervalMs = input.pollIntervalMs;
    if (input.downloadRetryAttempts !== undefined) provider.downloadRetryAttempts = input.downloadRetryAttempts;
    if (input.proxyUrl !== undefined) provider.proxyUrl = input.proxyUrl;
    if (input.downloadProxyUrl !== undefined) provider.downloadProxyUrl = input.downloadProxyUrl;
    if (input.disableProxy !== undefined) provider.disableProxy = input.disableProxy;

    this.save(config);
    return this.adminConfig().providers.find((item) => item.id === provider.id);
  }

  deleteProvider(providerId: string) {
    const config = this.getConfig();
    const provider = this.requireProvider(config, providerId);
    if (this.routingUsesProvider(config.routing.default, provider.id)
      || this.routingUsesProvider(config.routing.professional, provider.id)) {
      throw new BadRequestException('默认路由正在使用该 Provider，请先调整路由');
    }
    config.providers = config.providers.filter((item) => item.id !== provider.id);
    this.save(config);
    return { ok: true, providerId: provider.id };
  }

  createModel(providerId: string, input: AdminAiModelInput) {
    const config = this.getConfig();
    const provider = this.requireProvider(config, providerId);
    if (this.findModel(provider, input.model)) throw new ConflictException(`模型已存在：${input.model}`);
    provider.models.push(structuredClone(input));
    if (!provider.defaultModel) provider.defaultModel = input.model;
    this.save(config);
    return structuredClone(input);
  }

  async syncModels(providerId: string): Promise<AdminAiModelSyncResult> {
    const before = this.requireProvider(this.getConfig(), providerId);
    if (!['openai-images', 'openai-compatible'].includes(before.type)) throw new BadRequestException('只有 OpenAI 兼容类型支持同步模型');
    const available = await this.availableModels(providerId);
    const config = this.getConfig();
    const provider = this.requireProvider(config, providerId);
    if (JSON.stringify(before) !== JSON.stringify(provider)) throw new ConflictException('渠道配置已变化，请重新同步');
    let added = 0;
    for (const item of available.models) {
      if (item.installed || !item.listed || !item.defaults) continue;
      provider.models.push({ ...structuredClone(item.defaults), enabled: false });
      added += 1;
    }
    if (added) {
      if (!provider.defaultModel) provider.defaultModel = provider.models[0].model;
      this.save(config);
    }
    return { providerId, fetched: available.models.filter(item => item.listed).length + available.omitted,
      added, existing: available.models.filter(item => item.installed && item.listed).length,
      skipped: available.omitted + available.models.filter(item => item.listed && !item.defaults && !item.installed).length,
      models: structuredClone(provider.models) };
  }

  updateModel(providerId: string, modelId: string, input: Partial<AdminAiModelInput>) {
    const config = this.getConfig();
    const provider = this.requireProvider(config, providerId);
    const model = this.requireModel(provider, modelId);
    if (input.model && input.model !== model.model) throw new BadRequestException('模型 id 不支持修改');
    const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    Object.assign(model, structuredClone(patch), { model: model.model });
    this.save(config);
    return structuredClone(model);
  }

  async availableModels(providerId: string): Promise<AvailableImageModels> {
    const provider = this.requireProvider(this.getConfig(), providerId);
    const remote = ['openai-images', 'openai-compatible'].includes(provider.type);
    const ids = remote ? await this.fetchImageModelIds(provider)
      : IMAGE_MODEL_PRESETS.filter(preset => preset.protocols.includes(provider.type)).map(preset => preset.model);
    const candidates = [...new Set([...ids, ...provider.models.map(model => model.model)])];
    const models = candidates.filter(id => imageModelPreset(provider.type, id) || provider.models.some(model => model.model === id) || /image|banana/i.test(id)).map(model => {
      const preset = imageModelPreset(provider.type, model);
      const existing = provider.models.find(item => item.model === model);
      const defaults = preset ? imageModelDefaults(preset, model) : undefined;
      // Existing restrictions may encode relay-specific limits; never broaden them on import.
      if (defaults && existing) {
        defaults.supportedRatios = defaults.supportedRatios.filter(value => existing.supportedRatios.includes(value));
        defaults.supportedQualities = defaults.supportedQualities.filter(value => existing.supportedQualities.includes(value));
        defaults.maxInputImages = Math.min(defaults.maxInputImages, existing.maxInputImages);
      }
      return { model, preset, defaults, installed: Boolean(existing), listed: remote && ids.includes(model) };
    });
    return { providerId, checkedAt: new Date().toISOString(), source: remote ? 'remote' : 'configured', models,
      omitted: candidates.length - models.length,
      message: remote ? '渠道已返回模型列表。没有文档预设的模型需手动配置参数。' : '依据接口文档提供预设;当前密钥的模型权限与出图能力尚未实测。' };
  }

  async installModels(providerId: string, modelIds: string[]) {
    if (!Array.isArray(modelIds) || !modelIds.length || modelIds.length > 50 || new Set(modelIds).size !== modelIds.length) {
      throw new BadRequestException('请选择 1-50 个不重复的模型');
    }
    const before = this.requireProvider(this.getConfig(), providerId);
    const available = await this.availableModels(providerId);
    const config = this.getConfig();
    const provider = this.requireProvider(config, providerId);
    if (JSON.stringify(before) !== JSON.stringify(provider)) throw new ConflictException('渠道配置已变化，请刷新后重新选择');
    for (const id of modelIds) {
      const item = available.models.find(model => model.model === id);
      if (!item?.defaults) throw new BadRequestException(`模型暂无可用预设：${id}`);
      if (!item.defaults.supportedRatios.length || !item.defaults.supportedQualities.length) throw new BadRequestException(`模型现有限制与官方参数不兼容：${id}`);
      const existing = provider.models.find(model => model.model === id);
      if (existing) {
        Object.assign(existing, { supportedRatios: item.defaults.supportedRatios,
          supportedQualities: item.defaults.supportedQualities, maxInputImages: item.defaults.maxInputImages });
      } else provider.models.push(structuredClone(item.defaults));
    }
    if (!provider.defaultModel) provider.defaultModel = modelIds[0];
    this.save(config);
    return { installed: modelIds.length };
  }

  private async fetchImageModelIds(provider: AiProviderConfig): Promise<string[]> {
    if (!provider.apiKey.trim()) throw new BadRequestException('请先配置 API Key');
    const base = provider.baseUrl.trim().replace(/\/+$/, '');
    const url = /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
    let response: Response;
    try {
      response = await fetch(await assertSafeExternalUrl(url), { headers: { Authorization: `Bearer ${provider.apiKey.trim()}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(30_000) });
    } catch { throw new BadRequestException('模型列表请求失败，请检查渠道地址和网络'); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new BadRequestException(`模型列表请求失败：HTTP ${response.status}`);
    }
    try {
      const payload = JSON.parse((await readLimitedResponse(response, 2 * 1024 * 1024)).toString('utf8'));
      if (!Array.isArray(payload?.data)) throw new Error('Invalid model list');
      return [...new Set<string>(payload.data.flatMap((item: { id?: unknown } | null) =>
        typeof item?.id === 'string' && idPattern.test(item.id) ? [item.id] : []))];
    } catch { throw new BadRequestException('模型列表响应格式不正确'); }
  }

  deleteModel(providerId: string, modelId: string) {
    const config = this.getConfig();
    const provider = this.requireProvider(config, providerId);
    const model = this.requireModel(provider, modelId);
    if (this.routingUsesModel(config.routing.default, provider.id, model.model)
      || this.routingUsesModel(config.routing.professional, provider.id, model.model)) {
      throw new BadRequestException('默认路由正在使用该模型，请先调整路由');
    }
    provider.models = provider.models.filter((item) => item.model !== model.model);
    if (provider.defaultModel === model.model) provider.defaultModel = provider.models[0]?.model ?? '';
    this.save(config);
    return { ok: true, providerId: provider.id, modelId: model.model };
  }

  updateRouting(routing: { default: AiRoutingTarget; professional: AiRoutingTarget }) {
    const config = this.getConfig();
    this.validateEnabledTarget(config, routing.default, 'default');
    this.validateEnabledTarget(config, routing.professional, 'professional');
    config.routing = structuredClone(routing);
    this.save(config);
    return structuredClone(config.routing);
  }

  setMockEnabled(mockEnabled: boolean) {
    const config = this.getConfig();
    config.mockEnabled = mockEnabled;
    this.save(config);
    return { mockEnabled };
  }

  private reloadIfChanged() {
    if (!existsSync(this.path)) {
      if (!this.cached) this.cached = this.loadFallbackConfig();
      return;
    }
    const mtimeMs = statSync(this.path).mtimeMs;
    if (this.cached && mtimeMs === this.cachedMtimeMs) return;
    const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as AiConfigDocument;
    this.validate(parsed);
    this.cached = parsed;
    this.cachedMtimeMs = mtimeMs;
  }

  private loadFallbackConfig() {
    const examplePath = resolve(dirname(this.path), 'ai-config.example.json');
    if (!existsSync(examplePath)) {
      throw new Error(`AI 配置不存在：${this.path}。请从 ai-config.example.json 创建配置文件。`);
    }
    const config = JSON.parse(readFileSync(examplePath, 'utf8')) as AiConfigDocument;
    this.applyLegacyEnvironment(config);
    this.validate(config);
    if (!this.warnedFallback) {
      this.warnedFallback = true;
      console.warn(`[ai-config] ${this.path} 不存在，临时使用示例配置和旧环境变量兼容层`);
    }
    return config;
  }

  private applyLegacyEnvironment(config: AiConfigDocument) {
    if (process.env.PROVIDER_MOCK_ENABLED) {
      config.mockEnabled = process.env.PROVIDER_MOCK_ENABLED !== 'false';
    }
    const legacy = [
      { id: 'grsai', key: 'GRSAI_API_KEY', base: 'GRSAI_BASE_URL' },
      { id: 'gemini-official', key: 'GEMINI_API_KEY', base: 'GEMINI_BASE_URL' },
      { id: 'tokenrun', key: 'TOKENRUN_API_KEY', base: 'TOKENRUN_BASE_URL' }
    ];
    for (const item of legacy) {
      const provider = config.providers.find((candidate) => candidate.id === item.id);
      if (!provider) continue;
      const apiKey = process.env[item.key]?.trim();
      const baseUrl = process.env[item.base]?.trim();
      if (apiKey) provider.apiKey = apiKey;
      if (baseUrl) provider.baseUrl = baseUrl;
    }
  }

  private save(config: AiConfigDocument) {
    this.validate(config);
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      renameSync(temporaryPath, this.path);
    } catch (error) {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      throw error;
    }
    this.cached = structuredClone(config);
    this.cachedMtimeMs = statSync(this.path).mtimeMs;
  }

  private validate(config: AiConfigDocument) {
    if (config.version !== 1) throw new BadRequestException('ai-config version 必须为 1');
    if (!Array.isArray(config.providers)) throw new BadRequestException('providers 必须是数组');
    const providerIds = new Set<string>();
    const providerAliases = new Set<string>();
    for (const provider of config.providers) {
      if (!idPattern.test(provider.id)) throw new BadRequestException(`Provider id 格式错误：${provider.id}`);
      if (providerIds.has(provider.id) || providerAliases.has(provider.id)) throw new BadRequestException(`Provider id 重复或与别名冲突：${provider.id}`);
      if (!providerTypes.has(provider.type)) throw new BadRequestException(`Provider type 不支持：${provider.type}`);
      if (!provider.baseUrl?.trim()) throw new BadRequestException(`${provider.id} Base URL 不能为空`);
      try {
        const parsed = new URL(provider.baseUrl);
        if (parsed.protocol !== 'https:') throw new Error('HTTPS required');
      } catch {
        throw new BadRequestException(`${provider.id} Base URL 必须是有效的 HTTPS URL`);
      }
      const pathValues = [provider.paths.generate, provider.paths.result, provider.paths.generations, provider.paths.edits];
      if (pathValues.some((path) => path !== undefined && (!path.startsWith('/') || path.startsWith('//')))) {
        throw new BadRequestException(`${provider.id} 请求路径必须是相对路径`);
      }
      if (provider.concurrency !== undefined
        && (!Number.isInteger(provider.concurrency) || provider.concurrency < 1 || provider.concurrency > 1000)) {
        throw new BadRequestException(`${provider.id} 并发数必须是 1-1000 的整数`);
      }
      if (provider.rpm !== undefined
        && (!Number.isInteger(provider.rpm) || provider.rpm < 0 || provider.rpm > 1_000_000)) {
        throw new BadRequestException(`${provider.id} RPM 必须是 0-1000000 的整数`);
      }
      if (provider.type === 'grsai' && (!provider.paths.generate || !provider.paths.result)) {
        throw new BadRequestException(`${provider.id} 需要 generate 和 result 请求路径`);
      }
      if (provider.type === 'gemini-official' && !provider.paths.generate) {
        throw new BadRequestException(`${provider.id} 需要 generate 请求路径`);
      }
      if ((provider.type === 'openai-images' || provider.type === 'openai-compatible') && (!provider.paths.generations || !provider.paths.edits)) {
        throw new BadRequestException(`${provider.id} 需要 generations 和 edits 请求路径`);
      }
      providerIds.add(provider.id);
      for (const alias of provider.aliases ?? []) {
        if (!idPattern.test(alias)) throw new BadRequestException(`Provider alias 格式错误：${alias}`);
        if (providerIds.has(alias) || providerAliases.has(alias)) throw new BadRequestException(`Provider alias 冲突：${alias}`);
        providerAliases.add(alias);
      }
      const modelIds = new Set<string>();
      for (const model of provider.models) {
        if (!idPattern.test(model.model)) throw new BadRequestException(`${provider.id} 模型 id 格式错误：${model.model}`);
        if (modelIds.has(model.model)) throw new BadRequestException(`${provider.id} 模型重复：${model.model}`);
        modelIds.add(model.model);
        if (!Array.isArray(model.supportedRatios) || !Array.isArray(model.supportedQualities)) {
          throw new BadRequestException(`${provider.id}/${model.model} 的比例或清晰度配置错误`);
        }
      }
      if (provider.defaultModel && !provider.models.some((model) => model.model === provider.defaultModel)) {
        throw new BadRequestException(`${provider.id} 默认模型不存在：${provider.defaultModel}`);
      }
    }
    this.validateTarget(config, config.routing.default, 'default');
    this.validateTarget(config, config.routing.professional, 'professional');
    this.validateEnabledTarget(config, config.routing.default, 'default');
    this.validateEnabledTarget(config, config.routing.professional, 'professional');
  }

  private validateTarget(config: AiConfigDocument, target: AiRoutingTarget, name: string) {
    const provider = this.findProvider(config, target.provider);
    if (!provider) throw new BadRequestException(`${name} 路由 Provider 不存在：${target.provider}`);
    if (!this.findModel(provider, target.model)) {
      throw new BadRequestException(`${name} 路由模型不存在：${target.provider}/${target.model}`);
    }
  }

  private validateEnabledTarget(config: AiConfigDocument, target: AiRoutingTarget, name: string) {
    const provider = this.findProvider(config, target.provider);
    const model = provider ? this.findModel(provider, target.model) : undefined;
    if (!provider?.enabled) throw new BadRequestException(`${name} 路由 Provider 已禁用：${target.provider}`);
    if (provider.fallbackOnly) throw new BadRequestException(`${name} 路由不能使用仅备用 Provider：${target.provider}`);
    if (!model?.enabled) throw new BadRequestException(`${name} 路由模型已禁用：${target.provider}/${target.model}`);
  }

  private findProvider(config: AiConfigDocument, providerId: string) {
    return config.providers.find((provider) => provider.id === providerId || provider.aliases?.includes(providerId));
  }

  private requireProvider(config: AiConfigDocument, providerId: string) {
    const provider = config.providers.find((item) => item.id === providerId);
    if (!provider) throw new NotFoundException(`AI Provider 不存在：${providerId}`);
    return provider;
  }

  private findModel(provider: AiProviderConfig, modelId: string) {
    return provider.models.find((model) => model.model === modelId || model.aliases?.includes(modelId));
  }

  private requireModel(provider: AiProviderConfig, modelId: string) {
    const model = provider.models.find((item) => item.model === modelId);
    if (!model) throw new NotFoundException(`模型不存在：${provider.id}/${modelId}`);
    return model;
  }

  private routingUsesProvider(target: AiRoutingTarget, providerId: string) {
    return target.provider === providerId;
  }

  private routingUsesModel(target: AiRoutingTarget, providerId: string, modelId: string) {
    return target.provider === providerId && target.model === modelId;
  }
}
