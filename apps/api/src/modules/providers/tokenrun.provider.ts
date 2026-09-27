import { Inject, Injectable } from '@nestjs/common';
import { tokenRunSizeFor } from '@picup/shared';
import { Agent, FormData, ProxyAgent, type Dispatcher } from 'undici';
import { ObjectStorageService } from '../../common/object-storage.service';
import { AiConfigService } from '../../common/ai-config/ai-config.service';
import { assertSafeExternalUrl, readLimitedResponse } from '../../common/safe-external-fetch';
import type { AiProviderConfig } from '../../common/ai-config/ai-config.types';
import type { ImageProvider, ProviderExecutionContext, ProviderImageInput, ProviderImageResult } from './provider.types';

const DEFAULT_TOKENRUN_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TOKENRUN_DOWNLOAD_ATTEMPTS = 3;
const retryableStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class TokenRunProvider implements ImageProvider {
  private readonly dispatchers = new Map<string, Dispatcher>();

  constructor(
    @Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService,
    @Inject(AiConfigService) private readonly aiConfig: AiConfigService
  ) {}

  async generate(input: ProviderImageInput, execution?: ProviderExecutionContext): Promise<ProviderImageResult> {
    const provider = this.aiConfig.getProvider(input.provider);
    try {
      return await this.generateWithProvider(input, provider.id, false);
    } catch (error) {
      const fallbackIds = [...new Set(provider.fallbackProviderIds ?? [])];
      const attemptedProviders = new Set([provider.id]);
      for (const fallbackId of fallbackIds) {
        let fallback: AiProviderConfig;
        try {
          fallback = this.aiConfig.getProvider(fallbackId, true);
        } catch {
          console.warn(`[tokenrun] fallback provider missing job=${input.jobId} provider=${fallbackId}`);
          continue;
        }
        if (attemptedProviders.has(fallback.id)) continue;
        attemptedProviders.add(fallback.id);
        if (!execution) throw new Error('备用渠道缺少任务执行上下文', { cause: error });
        // Coordination failures must stop this attempt, rather than starting
        // another paid request after losing the job/slot lease.
        await execution.switchProvider(fallback.id);
        try {
          console.warn(`[tokenrun] fallback job=${input.jobId} from=${provider.id} to=${fallback.id}`);
          return await this.generateWithProvider({ ...input, provider: fallback.id }, fallback.id, true);
        } catch (fallbackError) {
          console.warn(`[tokenrun] fallback failed job=${input.jobId} provider=${fallbackId}`);
        }
      }
      if (!fallbackIds.length) throw error;
      throw new Error('图片主渠道及备用渠道均不可用，请稍后重试', { cause: error });
    }
  }

  private async generateWithProvider(input: ProviderImageInput, providerId: string, includeDisabled: boolean): Promise<ProviderImageResult> {
    const provider = this.aiConfig.getProvider(providerId, includeDisabled);
    if (provider.type !== 'openai-images' && provider.type !== 'openai-compatible') throw new Error(`Provider ${provider.id} 不是 OpenAI 兼容类型`);
    const modelConfig = this.aiConfig.getModel(provider.id, input.model, includeDisabled).model;
    if (!modelConfig.supportedQualities.includes(input.quality)
      || !modelConfig.supportedRatios.includes(input.aspectRatio)
      || input.images.length > modelConfig.maxInputImages) {
      throw new Error('渠道不支持当前尺寸、比例或参考图数量');
    }
    const apiKey = provider.apiKey.trim();
    if (!apiKey) throw new Error(`${provider.displayName} API Key 未配置`);
    const requestInput = { ...input, model: modelConfig.upstreamModel ?? modelConfig.model };

    const baseUrl = this.normalizeBaseUrl(provider.baseUrl);
    const endpoint = input.images.length > 0
      ? provider.paths.edits || '/v1/images/edits'
      : provider.paths.generations || '/v1/images/generations';
    const body = input.images.length > 0
      ? await this.buildEditRequest(requestInput, provider)
      : this.buildGenerationRequest(requestInput, provider);

    console.log(`[tokenrun] request job=${input.jobId} model=${input.model} endpoint=${endpoint} ratio=${input.aspectRatio} quality=${input.quality}`);
    let response: Response;
    try {
      response = await fetch(/^https?:\/\//i.test(endpoint) ? endpoint : `${baseUrl}${endpoint}`, {
        method: 'POST',
        signal: AbortSignal.timeout(provider.timeoutMs || DEFAULT_TOKENRUN_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
        },
        body: body instanceof FormData ? body : JSON.stringify(body),
        dispatcher: this.createDispatcher(this.apiProxyUrl(provider), provider)
      } as RequestInit & { dispatcher: Dispatcher });
    } catch (error) {
      throw new Error(`TokenRun API network failed: ${this.describeError(error)}`, { cause: error });
    }

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`TokenRun GPT Image request failed: ${response.status} ${message}`);
    }

    return this.parseResponse(input.outputKey ?? input.jobId, await response.json() as TokenRunImageResponse, provider);
  }

  private buildGenerationRequest(input: ProviderImageInput, provider?: AiProviderConfig) {
    return {
      model: input.model,
      prompt: input.prompt,
      size: this.sizeFor(input, provider),
      quality: provider?.imageQuality ?? this.qualityFor(input),
      ...(provider?.imageResponseFormat ? { response_format: provider.imageResponseFormat, n: 1 } : {}),
      ...(input.background ? { background: input.background } : {}),
      output_format: 'png'
    };
  }

  private async buildEditRequest(input: ProviderImageInput, provider?: AiProviderConfig) {
    const form = new FormData();
    form.set('model', input.model);
    form.set('prompt', input.prompt);
    form.set('size', this.sizeFor(input, provider));
    form.set('quality', provider?.imageQuality ?? this.qualityFor(input));
    if (provider?.imageResponseFormat) form.set('response_format', provider.imageResponseFormat);
    form.set('output_format', 'png');
    if (input.background) form.set('background', input.background);
    if (input.mask) {
      const buffer = await this.objectStorage.readByUrl(input.mask.url);
      form.set('mask', new File([new Uint8Array(buffer)], 'mask.png', { type: 'image/png' }));
    }

    for (const image of input.images) {
      const sourceName = this.objectStorage.filenameFromUrl(image.url);
      const buffer = await this.objectStorage.readByUrl(image.url);
      form.append('image[]', new File([new Uint8Array(buffer)], sourceName, { type: image.mimeType }));
    }

    return form;
  }

  private async parseResponse(jobId: string, payload: TokenRunImageResponse, provider: AiProviderConfig): Promise<ProviderImageResult> {
    const images: ProviderImageResult['images'] = [];

    for (const item of payload.data ?? []) {
      if (item.b64_json) {
        const mimeType = this.mimeTypeFromBase64(item.b64_json);
        const extension = mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png';
        const filename = `${jobId}-tokenrun-${images.length + 1}${extension}`;
        const url = await this.objectStorage.save('outputs', filename, Buffer.from(item.b64_json, 'base64'), mimeType);
        images.push({ url, mimeType });
        continue;
      }
      if (item.url) {
        const saved = await this.downloadOutput(jobId, item.url, images.length + 1, provider);
        images.push(saved);
      }
    }

    if (images.length === 0) throw new Error('TokenRun GPT Image returned no images');
    return { images, textOutputs: [] };
  }

  private async downloadOutput(jobId: string, sourceUrl: string, index: number, provider: AiProviderConfig) {
    sourceUrl = await assertSafeExternalUrl(sourceUrl);
    const attempts = this.downloadAttempts(provider);
    const host = this.urlHost(sourceUrl);
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const proxy = this.downloadProxyForAttempt(provider, attempt);
      try {
        const response = await fetch(sourceUrl, {
          redirect: 'error',
          headers: { Referer: `${this.normalizeBaseUrl(provider.baseUrl)}/` },
          dispatcher: this.createDispatcher(proxy, provider)
        } as RequestInit & { dispatcher: Dispatcher });
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          if (!retryableStatusCodes.has(response.status)) break;
          await response.body?.cancel().catch(() => undefined);
        } else {
          const mimeType = (response.headers.get('content-type') ?? 'image/png').split(';')[0];
          if (!mimeType.startsWith('image/')) throw new Error(`unexpected content-type ${mimeType}`);
          const extension = mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png';
          const filename = `${jobId}-tokenrun-${index}${extension}`;
          const outputUrl = await this.objectStorage.save('outputs', filename, await readLimitedResponse(response), mimeType);
          return { url: outputUrl, mimeType };
        }
      } catch (error) {
        lastError = this.describeError(error);
      }

      console.warn(`[tokenrun] output download retry host=${host} attempt=${attempt}/${attempts} proxy=${proxy ? 'yes' : 'no'} error=${lastError}`);
      await this.sleep(500 * attempt);
    }

    throw new Error(`TokenRun image download failed host=${host}: ${lastError}`);
  }

  private qualityFor(input: ProviderImageInput) {
    if (input.quality === '4K') return 'high';
    if (input.quality === '1K' || input.quality === '512') return 'low';
    return 'medium';
  }

  private sizeFor(input: ProviderImageInput, _provider?: AiProviderConfig) {
    // Keep the relay's explicit size mapping while preserving auto-ratio requests.
    return tokenRunSizeFor(input.aspectRatio, input.quality);
  }

  private mimeTypeFromBase64(value: string) {
    const header = Buffer.from(value.slice(0, 16), 'base64');
    if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (header.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46]))) return 'image/webp';
    return 'image/png';
  }

  private createDispatcher(proxy: string | undefined, provider: AiProviderConfig): Dispatcher {
    const timeoutMs = Number(provider.timeoutMs) || DEFAULT_TOKENRUN_TIMEOUT_MS;
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

  private downloadAttempts(provider: AiProviderConfig) {
    const value = Number(provider.downloadRetryAttempts);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_TOKENRUN_DOWNLOAD_ATTEMPTS;
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

  private normalizeBaseUrl(url: string) {
    return url.replace(/\/+$/, '');
  }
}

interface TokenRunImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
}
