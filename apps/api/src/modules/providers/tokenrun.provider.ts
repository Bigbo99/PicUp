import { Inject, Injectable } from '@nestjs/common';
import { tokenRunSizeFor } from '@picup/shared';
import { Agent, FormData, ProxyAgent, type Dispatcher } from 'undici';
import { ObjectStorageService } from '../../common/object-storage.service';
import type { ImageProvider, ProviderImageInput, ProviderImageResult } from './provider.types';

const DEFAULT_TOKENRUN_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TOKENRUN_BASE_URL = 'https://tokenrun.ai-mendao.xyz';
const DEFAULT_TOKENRUN_DOWNLOAD_ATTEMPTS = 3;
const retryableStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class TokenRunProvider implements ImageProvider {
  private readonly dispatchers = new Map<string, Dispatcher>();

  constructor(@Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService) {}

  async generate(input: ProviderImageInput): Promise<ProviderImageResult> {
    const apiKey = process.env.TOKENRUN_API_KEY;
    if (!apiKey) throw new Error('TOKENRUN_API_KEY is not configured');

    const baseUrl = this.normalizeBaseUrl(
      process.env.TOKENRUN_BASE_URL ?? DEFAULT_TOKENRUN_BASE_URL
    );
    const endpoint = input.images.length > 0 ? '/v1/images/edits' : '/v1/images/generations';
    const body = input.images.length > 0
      ? await this.buildEditRequest(input)
      : this.buildGenerationRequest(input);

    console.log(`[tokenrun] request job=${input.jobId} model=${input.model} endpoint=${endpoint} ratio=${input.aspectRatio} quality=${input.quality}`);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
        },
        body: body instanceof FormData ? body : JSON.stringify(body),
        dispatcher: this.createDispatcher(this.apiProxyUrl())
      } as RequestInit & { dispatcher: Dispatcher });
    } catch (error) {
      throw new Error(`TokenRun API network failed: ${this.describeError(error)}`);
    }

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`TokenRun GPT Image request failed: ${response.status} ${message}`);
    }

    return this.parseResponse(input.jobId, await response.json() as TokenRunImageResponse);
  }

  private buildGenerationRequest(input: ProviderImageInput) {
    return {
      model: input.model,
      prompt: input.prompt,
      size: tokenRunSizeFor(input.aspectRatio, input.quality),
      quality: this.qualityFor(input),
      output_format: 'png'
    };
  }

  private async buildEditRequest(input: ProviderImageInput) {
    const form = new FormData();
    form.set('model', input.model);
    form.set('prompt', input.prompt);
    form.set('size', tokenRunSizeFor(input.aspectRatio, input.quality));
    form.set('quality', this.qualityFor(input));
    form.set('output_format', 'png');

    for (const image of input.images) {
      const sourceName = this.objectStorage.filenameFromUrl(image.url);
      const buffer = await this.objectStorage.readByUrl(image.url);
      form.append('image[]', new File([buffer], sourceName, { type: image.mimeType }));
    }

    return form;
  }

  private async parseResponse(jobId: string, payload: TokenRunImageResponse): Promise<ProviderImageResult> {
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
        const saved = await this.downloadOutput(jobId, item.url, images.length + 1);
        images.push(saved);
      }
    }

    if (images.length === 0) throw new Error('TokenRun GPT Image returned no images');
    return { images, textOutputs: [] };
  }

  private async downloadOutput(jobId: string, sourceUrl: string, index: number) {
    const attempts = this.downloadAttempts();
    const host = this.urlHost(sourceUrl);
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const proxy = this.downloadProxyForAttempt(attempt);
      try {
        const response = await fetch(sourceUrl, {
          headers: { Referer: `${this.normalizeBaseUrl(process.env.TOKENRUN_BASE_URL ?? DEFAULT_TOKENRUN_BASE_URL)}/` },
          dispatcher: this.createDispatcher(proxy)
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
          const outputUrl = await this.objectStorage.save('outputs', filename, Buffer.from(await response.arrayBuffer()), mimeType);
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

  private mimeTypeFromBase64(value: string) {
    const header = Buffer.from(value.slice(0, 16), 'base64');
    if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (header.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46]))) return 'image/webp';
    return 'image/png';
  }

  private createDispatcher(proxy: string | undefined): Dispatcher {
    const timeoutMs = Number(
      process.env.TOKENRUN_TIMEOUT_MS ?? process.env.GEMINI_REQUEST_TIMEOUT_MS
    ) || DEFAULT_TOKENRUN_TIMEOUT_MS;
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

  private apiProxyUrl() {
    return process.env.TOKENRUN_PROXY_URL?.trim()
      || process.env.HTTPS_PROXY?.trim()
      || process.env.HTTP_PROXY?.trim()
      || undefined;
  }

  private downloadProxyForAttempt(attempt: number) {
    const explicit = process.env.TOKENRUN_DOWNLOAD_PROXY_URL?.trim();
    if (explicit) return explicit;
    return attempt % 2 === 0 ? this.apiProxyUrl() : undefined;
  }

  private downloadAttempts() {
    const value = Number(process.env.TOKENRUN_DOWNLOAD_RETRY_ATTEMPTS);
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
