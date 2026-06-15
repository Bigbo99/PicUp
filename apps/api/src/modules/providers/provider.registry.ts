import { Inject, Injectable } from '@nestjs/common';
import type { ImageProviderName } from '@picup/shared';
import { GeminiProvider } from './gemini.provider';
import { MockProvider } from './mock.provider';
import type { ImageProvider } from './provider.types';
import { TokenRunProvider } from './tokenrun.provider';

@Injectable()
export class ProviderRegistry {
  constructor(
    @Inject(MockProvider)
    private readonly mock: MockProvider,
    @Inject(GeminiProvider)
    private readonly gemini: GeminiProvider,
    @Inject(TokenRunProvider)
    private readonly tokenrun: TokenRunProvider
  ) {}

  get(provider: Exclude<ImageProviderName, 'auto'>): ImageProvider {
    const mockEnabled = process.env.PROVIDER_MOCK_ENABLED !== 'false';
    if (mockEnabled) {
      console.log(`[provider] mock enabled, requested=${provider}`);
      return this.mock;
    }
    console.log(`[provider] using ${provider}`);
    if (provider === 'gemini') return this.gemini;
    return this.tokenrun;
  }
}
