import { Inject, Injectable } from '@nestjs/common';
import type { ImageProviderName } from '@picup/shared';
import { GeminiProvider } from './gemini.provider';
import { GrsAiProvider } from './grsai.provider';
import { MockProvider } from './mock.provider';
import type { ImageProvider } from './provider.types';

@Injectable()
export class ProviderRegistry {
  constructor(
    @Inject(MockProvider)
    private readonly mock: MockProvider,
    @Inject(GeminiProvider)
    private readonly gemini: GeminiProvider,
    @Inject(GrsAiProvider)
    private readonly grsai: GrsAiProvider
  ) {}

  get(provider: Exclude<ImageProviderName, 'auto'>): ImageProvider {
    const mockEnabled = process.env.PROVIDER_MOCK_ENABLED !== 'false';
    if (mockEnabled) {
      console.log(`[provider] mock enabled, requested=${provider}`);
      return this.mock;
    }
    console.log(`[provider] using ${provider}`);
    if (provider === 'gemini') return this.gemini;
    return this.grsai;
  }
}
