import { Inject, Injectable } from '@nestjs/common';
import { Agent, FormData, ProxyAgent, type Dispatcher } from 'undici';
import { ObjectStorageService } from '../../common/object-storage.service';
import type { ImageProvider, ProviderImageInput, ProviderImageResult } from './provider.types';

const DEFAULT_TOKENRUN_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TOKENRUN_BASE_URL = 'https://tokenrun.ai-mendao.xyz';

@Injectable()
export class TokenRunProvider implements ImageProvider {
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
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' })
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
      dispatcher: this.createDispatcher()
    } as RequestInit & { dispatcher: Dispatcher });

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
      size: this.sizeFor(input),
      quality: this.qualityFor(input),
      output_format: 'png'
    };
  }

  private async buildEditRequest(input: ProviderImageInput) {
    const form = new FormData();
    form.set('model', input.model);
    form.set('prompt', input.prompt);
    form.set('size', this.sizeFor(input));
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
    const response = await fetch(sourceUrl, { dispatcher: this.createDispatcher() } as RequestInit & { dispatcher: Dispatcher });
    if (!response.ok) throw new Error(`TokenRun image download failed: ${response.status}`);

    const mimeType = response.headers.get('content-type') ?? 'image/png';
    const extension = mimeType.includes('jpeg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png';
    const filename = `${jobId}-tokenrun-${index}${extension}`;
    const outputUrl = await this.objectStorage.save('outputs', filename, Buffer.from(await response.arrayBuffer()), mimeType);
    return { url: outputUrl, mimeType };
  }

  private sizeFor(input: ProviderImageInput) {
    if (input.aspectRatio === 'auto') return 'auto';
    if (input.quality === '4K') {
      if (input.aspectRatio === '9:16' || input.aspectRatio === '3:4' || input.aspectRatio === '4:5') return '2160x3840';
      if (input.aspectRatio === '16:9' || input.aspectRatio === '4:3') return '3840x2160';
      return '2880x2880';
    }
    if (input.quality === '2K') {
      if (input.aspectRatio === '9:16' || input.aspectRatio === '3:4' || input.aspectRatio === '4:5') return '1152x2048';
      if (input.aspectRatio === '16:9' || input.aspectRatio === '4:3') return '2048x1152';
      return '2048x2048';
    }
    if (input.aspectRatio === '9:16' || input.aspectRatio === '3:4' || input.aspectRatio === '4:5') return '1024x1536';
    if (input.aspectRatio === '16:9' || input.aspectRatio === '4:3') return '1536x1024';
    return '1024x1024';
  }

  private qualityFor(input: ProviderImageInput) {
    if (input.quality === '4K') return 'high';
    if (input.quality === '512') return 'low';
    return 'medium';
  }

  private mimeTypeFromBase64(value: string) {
    const header = Buffer.from(value.slice(0, 16), 'base64');
    if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (header.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46]))) return 'image/webp';
    return 'image/png';
  }

  private createDispatcher(): Dispatcher {
    const timeoutMs = Number(
      process.env.TOKENRUN_TIMEOUT_MS ?? process.env.GEMINI_REQUEST_TIMEOUT_MS
    ) || DEFAULT_TOKENRUN_TIMEOUT_MS;
    const options = {
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connectTimeout: Math.min(timeoutMs, 120_000)
    };
    const proxy = process.env.TOKENRUN_PROXY_URL?.trim()
      || process.env.HTTPS_PROXY?.trim()
      || process.env.HTTP_PROXY?.trim()
      || undefined;
    if (proxy) return new ProxyAgent({ uri: proxy, ...options });
    return new Agent(options);
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
