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
  AdminAiModelConfig,
  AdminAiModelInput,
  AdminAiProviderInput,
  AiProviderType,
  AiRoutingTarget,
  ImageJobCreateRequest,
  ModelConfig,
  ModelsResponse
} from '@picup/shared';
import type { AiConfigDocument, AiProviderConfig } from './ai-config.types';

const providerTypes = new Set<AiProviderType>(['grsai', 'gemini-official', 'openai-images']);
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
    const models = config.providers.flatMap((provider) => provider.models.map<ModelConfig>((model) => ({
      id: `${provider.id}:${model.model}`,
      provider: provider.id,
      providerDisplayName: provider.displayName,
      providerType: provider.type,
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
    const usesProfessionalRoute = input.quality === '4K'
      || professionalTemplates.has(input.template)
      || input.imageIds.length >= 4;
    const automaticTarget = usesProfessionalRoute ? config.routing.professional : config.routing.default;
    const requestedProvider = input.provider === 'auto' ? automaticTarget.provider : input.provider;
    const provider = this.findProvider(config, requestedProvider);
    if (!provider || !provider.enabled) throw new BadRequestException('当前 AI Provider 不可用');

    const requestedModel = input.provider === 'auto'
      ? automaticTarget.model
      : input.model === 'auto'
        ? provider.defaultModel
        : input.model;
    const model = this.findModel(provider, requestedModel);
    if (!model || !model.enabled) throw new BadRequestException('当前模型不可用');

    return { provider, model };
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

  updateModel(providerId: string, modelId: string, input: Partial<AdminAiModelInput>) {
    const config = this.getConfig();
    const provider = this.requireProvider(config, providerId);
    const model = this.requireModel(provider, modelId);
    if (input.model && input.model !== model.model) throw new BadRequestException('模型 id 不支持修改');
    Object.assign(model, structuredClone(input), { model: model.model });
    this.save(config);
    return structuredClone(model);
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
      if (provider.type === 'openai-images' && (!provider.paths.generations || !provider.paths.edits)) {
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
