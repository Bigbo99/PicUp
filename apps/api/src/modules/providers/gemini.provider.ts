import { Inject, Injectable } from '@nestjs/common';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { ObjectStorageService } from '../../common/object-storage.service';
import type { ImageProvider, ProviderImageInput, ProviderImageResult } from './provider.types';

// Legacy Google implementation retained for reference; ProvidersModule now routes Gemini selections to GrsaiProvider.
const DEFAULT_GEMINI_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_GEMINI_RETRY_ATTEMPTS = 3;
const DEFAULT_GEMINI_RETRY_DELAY_MS = 1500;
const transientStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class GeminiProvider implements ImageProvider {
  constructor(@Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService) {}

  async generate(input: ProviderImageInput): Promise<ProviderImageResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY 未配置');

    const body = await this.buildRequest(input);
    const baseUrl = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com';
    console.log(`[gemini] request job=${input.jobId} model=${input.model} ratio=${input.aspectRatio} quality=${input.quality}`);
    const response = await this.fetchGemini(`${baseUrl}/v1beta/models/${input.model}:generateContent`, apiKey, body);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Gemini 调用失败：${response.status} ${message}`);
    }

    const payload = await response.json() as GeminiResponse;
    console.log(`[gemini] response job=${input.jobId} status=${response.status}`);
    return this.parseResponse(input.jobId, payload);
  }

  private async fetchGemini(url: string, apiKey: string, body: unknown) {
    const retryAttempts = this.getRetryAttempts();
    const retryDelayMs = this.getRetryDelayMs();
    let lastError = 'unknown network error';

    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      try {
        const response = await this.fetchGeminiOnce(url, apiKey, body);
        if (!transientStatusCodes.has(response.status) || attempt === retryAttempts) return response;
        lastError = `HTTP ${response.status}`;
        await response.text().catch(() => undefined);
      } catch (error) {
        lastError = this.describeFetchError(error);
        if (attempt === retryAttempts) break;
      }

      const delayMs = retryDelayMs * attempt;
      console.warn(`[gemini] transient failure attempt=${attempt}/${retryAttempts} retryInMs=${delayMs} error=${lastError}`);
      await this.sleep(delayMs);
    }

    throw new Error(`Gemini network request failed: ${lastError}`);
  }

  private async fetchGeminiOnce(url: string, apiKey: string, body: unknown) {
    const proxy = this.getProxyUrl();
    const timeoutMs = this.getTimeoutMs();
    const init: RequestInit & { dispatcher: Dispatcher } = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body),
      dispatcher: this.createDispatcher(proxy, timeoutMs)
    };
    if (proxy) console.log(`[gemini] proxy enabled timeoutMs=${timeoutMs}`);

    try {
      return await fetch(url, init);
    } catch (error) {
      throw new Error(`Gemini 网络请求失败：${this.describeFetchError(error)}`);
    }
  }

  private createDispatcher(proxy: string | undefined, timeoutMs: number): Dispatcher {
    const options = {
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connectTimeout: Math.min(timeoutMs, 120_000)
    };
    if (proxy) return new ProxyAgent({ uri: proxy, ...options });
    return new Agent(options);
  }

  private getTimeoutMs() {
    const value = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_GEMINI_TIMEOUT_MS;
  }

  private getRetryAttempts() {
    const value = Number(process.env.GEMINI_RETRY_ATTEMPTS);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_GEMINI_RETRY_ATTEMPTS;
  }

  private getRetryDelayMs() {
    const value = Number(process.env.GEMINI_RETRY_DELAY_MS);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_GEMINI_RETRY_DELAY_MS;
  }

  private getProxyUrl() {
    if (process.env.GEMINI_DISABLE_PROXY === 'true') return undefined;
    return process.env.GEMINI_PROXY_URL?.trim()
      || process.env.HTTPS_PROXY?.trim()
      || process.env.HTTP_PROXY?.trim()
      || undefined;
  }

  private sleep(ms: number) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
  }

  private describeFetchError(error: unknown) {
    if (!(error instanceof Error)) return '未知网络错误';
    const cause = error.cause;
    if (cause && typeof cause === 'object') {
      const code = 'code' in cause ? String(cause.code) : '';
      const message = 'message' in cause ? String(cause.message) : '';
      return [error.message, code, message].filter(Boolean).join(' / ');
    }
    return error.message;
  }

  private async buildRequest(input: ProviderImageInput) {
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
    for (const image of input.images) {
      const buffer = await this.objectStorage.readByUrl(image.url);
      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: buffer.toString('base64')
        }
      });
    }

    const generationConfig: Record<string, unknown> = {
      responseModalities: ['IMAGE']
    };
    if (input.aspectRatio !== 'auto') {
      const imageConfig: Record<string, string> = {
        aspectRatio: input.aspectRatio
      };
      const imageSize = this.getImageSize(input);
      if (imageSize) imageConfig.imageSize = imageSize;
      generationConfig.responseFormat = { image: imageConfig };
    }

    return {
      contents: [{ parts }],
      generationConfig
    };
  }

  private getImageSize(input: ProviderImageInput) {
    if (input.model === 'gemini-2.5-flash-image') return undefined;
    return input.quality;
  }

  private async parseResponse(jobId: string, payload: GeminiResponse): Promise<ProviderImageResult> {
    const images: ProviderImageResult['images'] = [];
    const textOutputs: string[] = [];

    for (const candidate of payload.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) textOutputs.push(part.text);
        const inlineData = part.inlineData ?? part.inline_data;
        if (inlineData?.data) {
          const mimeType = this.getInlineMimeType(inlineData);
          const extension = mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png';
          const filename = `${jobId}-${images.length + 1}${extension}`;
          const url = await this.objectStorage.save('outputs', filename, Buffer.from(inlineData.data, 'base64'), mimeType);
          images.push({ url, mimeType });
        }
      }
    }

    if (images.length === 0) throw new Error('Gemini 未返回图片');
    return { images, textOutputs };
  }

  private getInlineMimeType(inlineData: { mimeType?: string; mime_type?: string }) {
    return inlineData.mimeType ?? inlineData.mime_type ?? 'image/png';
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          data?: string;
          mimeType?: string;
        };
        inline_data?: {
          data?: string;
          mime_type?: string;
        };
      }>;
    };
  }>;
}
