import { Inject, Injectable } from '@nestjs/common';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { ObjectStorageService } from '../../common/object-storage.service';
import { AiConfigService } from '../../common/ai-config/ai-config.service';
import type { AiProviderConfig } from '../../common/ai-config/ai-config.types';
import type { ImageProvider, ProviderImageInput, ProviderImageResult } from './provider.types';

const DEFAULT_GRSAI_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_GRSAI_POLL_INTERVAL_MS = 2000;
const DEFAULT_DOWNLOAD_ATTEMPTS = 3;
const retryableStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class GrsaiProvider implements ImageProvider {
  private readonly dispatchers = new Map<string, Dispatcher>();

  constructor(
    @Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService,
    @Inject(AiConfigService) private readonly aiConfig: AiConfigService
  ) {}

  async generate(input: ProviderImageInput): Promise<ProviderImageResult> {
    const provider = this.aiConfig.getProvider(input.provider);
    if (provider.type !== 'grsai') throw new Error(`Provider ${provider.id} 不是 GrsAI 类型`);
    const modelConfig = this.aiConfig.getModel(provider.id, input.model).model;
    const apiKey = provider.apiKey.trim();
    if (!apiKey) throw new Error(`${provider.displayName} API Key 未配置`);

    const imageSize = input.quality === '512' ? '1K' : input.quality;
    const urls = await Promise.all(input.images.map((image) => this.imageSource(image.url, image.mimeType)));
    const upstreamModel = modelConfig.qualityModelOverrides?.[input.quality]
      ?? modelConfig.upstreamModel
      ?? modelConfig.model;
    let route = { model: upstreamModel, reason: upstreamModel === modelConfig.model ? 'configured-model' : `quality-${input.quality}-override` };
    let task = await this.createTask(input, route, imageSize, urls, apiKey, provider);

    const fallbackModel = modelConfig.fallbackModels?.find((model) => model !== route.model);
    if (!this.isSucceeded(task) && fallbackModel && this.shouldFallback(task)) {
      console.warn(`[grsai] fallback job=${input.jobId} from=${route.model} to=${fallbackModel} task=${task.id ?? 'unknown'} error=${this.taskFailureMessage(task)}`);
      route = { model: fallbackModel, reason: 'configured-fallback' };
      task = await this.createTask(input, route, imageSize, urls, apiKey, provider);
    }

    if (!this.isSucceeded(task)) {
      throw new Error(`Grsai generation failed: ${this.taskFailureMessage(task)}`);
    }

    const images: ProviderImageResult['images'] = [];
    const textOutputs: string[] = [];
    for (const result of task.results ?? []) {
      if (result.content) textOutputs.push(result.content);
      if (!result.url) continue;
      images.push(await this.downloadOutput(input.jobId, result.url, images.length + 1, provider));
    }

    if (images.length === 0) throw new Error('Grsai 未返回图片');
    console.log(`[grsai] completed job=${input.jobId} task=${task.id ?? 'unknown'} outputs=${images.length}`);
    return { images, textOutputs };
  }

  private async createTask(
    input: ProviderImageInput,
    route: GrsaiModelRoute,
    imageSize: string,
    urls: string[],
    apiKey: string,
    provider: AiProviderConfig
  ) {
    const body = {
      model: route.model,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      imageSize,
      urls,
      shutProgress: false
    };

    console.log(`[grsai] request job=${input.jobId} frontendModel=${input.model} upstreamModel=${route.model} routeReason=${route.reason} auto=${input.automaticModelSelection} template=${input.template} ratio=${input.aspectRatio} quality=${imageSize} refs=${input.images.length}`);
    const response = await this.request(this.endpoint(provider, provider.paths.generate, '/v1/draw/nano-banana'), apiKey, body, 'create task', provider);
    if (!response.ok) throw await this.responseError('create task', response);
    return this.readTaskStream(response, apiKey, provider);
  }

  private async readTaskStream(response: Response, apiKey: string, provider: AiProviderConfig) {
    if (!response.body) {
      const payload = this.normalizeTask(await response.json());
      if (this.isFinal(payload)) return payload;
      if (payload.id) return this.pollResult(payload.id, apiKey, provider);
      throw new Error('Grsai response did not include a task id');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let latest: GrsaiTaskData = {};

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = done ? '' : lines.pop() ?? '';

        for (const line of lines) {
          const task = this.parseStreamLine(line);
          if (!task) continue;
          latest = { ...latest, ...task };
          if (task.progress !== undefined) {
            console.log(`[grsai] task=${task.id ?? latest.id ?? 'unknown'} status=${task.status ?? 'running'} progress=${task.progress}`);
          }
          if (this.isFinal(latest)) return latest;
        }
        if (done) break;
      }
    } catch (error) {
      console.warn(`[grsai] stream interrupted task=${latest.id ?? 'unknown'} error=${this.describeError(error)}`);
    }

    const trailing = this.parseStreamLine(buffer);
    if (trailing) latest = { ...latest, ...trailing };
    if (this.isFinal(latest)) return latest;
    if (latest.id) return this.pollResult(latest.id, apiKey, provider);
    throw new Error('Grsai stream ended before a task id or final result was received');
  }

  private parseStreamLine(line: string): GrsaiTaskData | undefined {
    const value = line.trim().replace(/^data:\s*/, '');
    if (!value || value === '[DONE]') return undefined;
    try {
      return this.normalizeTask(JSON.parse(value) as GrsaiTaskData | GrsaiEnvelope);
    } catch {
      return undefined;
    }
  }

  private async pollResult(taskId: string, apiKey: string, provider: AiProviderConfig) {
    const deadline = Date.now() + this.timeoutMs(provider);
    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs(provider));
      const response = await this.request(this.endpoint(provider, provider.paths.result, '/v1/draw/result'), apiKey, { id: taskId }, `poll task ${taskId}`, provider);
      if (!response.ok) {
        if (retryableStatusCodes.has(response.status)) continue;
        throw await this.responseError(`poll task ${taskId}`, response);
      }
      const task = this.normalizeTask(await response.json() as GrsaiEnvelope);
      console.log(`[grsai] poll task=${taskId} status=${task.status ?? 'running'} progress=${task.progress ?? 0}`);
      if (this.isFinal(task)) return task;
    }
    throw new Error(`Grsai task timed out after ${this.timeoutMs(provider)}ms: ${taskId}`);
  }

  private async request(url: string, apiKey: string, body: unknown, stage: string, provider: AiProviderConfig) {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        dispatcher: this.createDispatcher(this.apiProxyUrl(provider), this.timeoutMs(provider))
      } as RequestInit & { dispatcher: Dispatcher });
    } catch (error) {
      throw new Error(`Grsai ${stage} network failed: ${this.describeError(error)}`);
    }
  }

  private async downloadOutput(jobId: string, sourceUrl: string, index: number, provider: AiProviderConfig) {
    const attempts = this.downloadAttempts(provider);
    let lastError = 'unknown error';
    const host = this.urlHost(sourceUrl);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const proxy = this.downloadProxyForAttempt(provider, attempt);
      try {
        const response = await fetch(sourceUrl, {
          headers: { Referer: `${this.normalizeBaseUrl(provider.baseUrl)}/` },
          dispatcher: this.createDispatcher(proxy, this.timeoutMs(provider))
        } as RequestInit & { dispatcher: Dispatcher });
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          if (!retryableStatusCodes.has(response.status)) break;
          await response.body?.cancel().catch(() => undefined);
        } else {
          const mimeType = (response.headers.get('content-type') ?? 'image/png').split(';')[0];
          if (!mimeType.startsWith('image/')) {
            throw new Error(`unexpected content-type ${mimeType}`);
          }
          const extension = mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png';
          const filename = `${jobId}-grsai-${index}${extension}`;
          const outputUrl = await this.objectStorage.save('outputs', filename, Buffer.from(await response.arrayBuffer()), mimeType);
          return { url: outputUrl, mimeType };
        }
      } catch (error) {
        lastError = this.describeError(error);
      }

      console.warn(`[grsai] output download retry host=${host} attempt=${attempt}/${attempts} proxy=${proxy ? 'yes' : 'no'} error=${lastError}`);
      await this.sleep(500 * attempt);
    }

    throw new Error(`Grsai output download failed host=${host}: ${lastError}`);
  }

  private async imageSource(url: string, mimeType: string) {
    // Qiniu CDN hotlink protection rejects external model-provider referers.
    const body = await this.objectStorage.readByUrl(url);
    return `data:${mimeType};base64,${body.toString('base64')}`;
  }

  private normalizeTask(payload: GrsaiTaskData | GrsaiEnvelope): GrsaiTaskData {
    if ('data' in payload && payload.data && typeof payload.data === 'object') return payload.data;
    return payload as GrsaiTaskData;
  }

  private isFinal(task: GrsaiTaskData) {
    return this.isSucceeded(task) || ['failed', 'error'].includes(task.status?.toLowerCase() ?? '');
  }

  private isSucceeded(task: GrsaiTaskData) {
    return task.status?.toLowerCase() === 'succeeded'
      || (task.progress === 100 && Boolean(task.results?.some((result) => result.url)));
  }

  private shouldFallback(task: GrsaiTaskData) {
    const failure = this.taskFailureMessage(task).toLowerCase();
    const contentRejectionMarkers = [
      'safety',
      'policy',
      'blocked',
      'violation',
      'sensitive',
      '违规',
      '敏感',
      '内容审核'
    ];
    return !contentRejectionMarkers.some((marker) => failure.includes(marker));
  }

  private taskFailureMessage(task: GrsaiTaskData) {
    return task.error || task.failure_reason || task.status || 'unknown error';
  }

  private apiProxyUrl(provider: AiProviderConfig) {
    if (provider.disableProxy) return undefined;
    return provider.proxyUrl?.trim()
      || process.env.HTTPS_PROXY?.trim()
      || process.env.HTTP_PROXY?.trim()
      || undefined;
  }

  private downloadProxyForAttempt(provider: AiProviderConfig, attempt: number) {
    const explicit = provider.downloadProxyUrl?.trim();
    if (explicit) return explicit;
    return attempt % 2 === 0 ? this.apiProxyUrl(provider) : undefined;
  }

  private createDispatcher(proxy: string | undefined, timeoutMs: number): Dispatcher {
    const key = `${proxy ?? 'direct'}:${timeoutMs}`;
    const existing = this.dispatchers.get(key);
    if (existing) return existing;

    const options = {
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connectTimeout: Math.min(timeoutMs, 120_000)
    };
    const dispatcher = proxy ? new ProxyAgent({ uri: proxy, ...options }) : new Agent(options);
    this.dispatchers.set(key, dispatcher);
    return dispatcher;
  }

  private timeoutMs(provider: AiProviderConfig) {
    const value = Number(provider.timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_GRSAI_TIMEOUT_MS;
  }

  private pollIntervalMs(provider: AiProviderConfig) {
    const value = Number(provider.pollIntervalMs);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_GRSAI_POLL_INTERVAL_MS;
  }

  private downloadAttempts(provider: AiProviderConfig) {
    const value = Number(provider.downloadRetryAttempts);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_DOWNLOAD_ATTEMPTS;
  }

  private endpoint(provider: AiProviderConfig, configuredPath: string | undefined, fallbackPath: string) {
    const path = configuredPath || fallbackPath;
    return /^https?:\/\//i.test(path) ? path : `${this.normalizeBaseUrl(provider.baseUrl)}${path}`;
  }

  private normalizeBaseUrl(url: string) {
    return url.replace(/\/+$/, '');
  }

  private async responseError(stage: string, response: Response) {
    const message = await response.text().catch(() => '');
    return new Error(`Grsai ${stage} failed: HTTP ${response.status} ${message}`);
  }

  private describeError(error: unknown) {
    if (!(error instanceof Error)) return String(error);
    const cause = error.cause;
    if (cause && typeof cause === 'object') {
      const code = 'code' in cause ? String(cause.code) : '';
      const message = 'message' in cause ? String(cause.message) : '';
      return [error.message, code, message].filter(Boolean).join(' / ');
    }
    return error.message;
  }

  private urlHost(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  private sleep(ms: number) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
  }
}

interface GrsaiEnvelope {
  code?: number;
  msg?: string;
  data?: GrsaiTaskData;
}

interface GrsaiTaskData {
  id?: string;
  results?: Array<{
    url?: string;
    content?: string;
  }>;
  progress?: number;
  status?: string;
  failure_reason?: string;
  error?: string;
}

interface GrsaiModelRoute {
  model: 'nano-banana-2' | 'nano-banana-pro' | 'nano-banana-pro-vt' | string;
  reason: string;
}
