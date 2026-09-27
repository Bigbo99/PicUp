import { Inject, Injectable } from '@nestjs/common';
import { AiConfigService } from '../../common/ai-config/ai-config.service';
import { GrsaiProvider } from './grsai.provider';
import { GeminiProvider } from './gemini.provider';
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
    @Inject(GeminiProvider)
    private readonly gemini: GeminiProvider,
    @Inject(TokenRunProvider)
    private readonly tokenrun: TokenRunProvider,
    @Inject(AiConfigService)
    private readonly aiConfig: AiConfigService
  ) {}

  get(providerId: string): ImageProvider {
    if (this.aiConfig.getConfig().mockEnabled) {
      console.log(`[provider] mock enabled, requested=${providerId}`);
      return this.mock;
    }
    const provider = this.aiConfig.getProvider(providerId);
    console.log(`[provider] using id=${provider.id} type=${provider.type}`);
    if (provider.type === 'grsai') return this.grsai;
    if (provider.type === 'gemini-official') return this.gemini;
    if (provider.type === 'openai-images' || provider.type === 'openai-compatible') return this.tokenrun;
    throw new Error(`Unsupported AI provider type: ${provider.type}`);
  }
}
