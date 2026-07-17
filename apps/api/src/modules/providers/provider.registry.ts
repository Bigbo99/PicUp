import { Inject, Injectable } from '@nestjs/common';
import type { ImageProviderName } from '@picup/shared';
import { GrsaiProvider } from './grsai.provider';
import { MockProvider } from './mock.provider';
import type { ImageProvider } from './provider.types';
import { TokenRunProvider } from './tokenrun.provider';

@Injectable()
export class ProviderRegistry {
  constructor(
    @Inject(MockProvider)
    private readonly mock: MockProvider,
    @Inject(GrsaiProvider)
    private readonly grsai: GrsaiProvider,
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
    if (provider === 'gemini') return this.grsai;
    return this.tokenrun;
  }
}
