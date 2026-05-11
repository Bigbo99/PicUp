import { Module } from '@nestjs/common';
import { ProviderRegistry } from './provider.registry';
import { MockProvider } from './mock.provider';
import { GeminiProvider } from './gemini.provider';
import { GrsAiProvider } from './grsai.provider';

@Module({
  providers: [ProviderRegistry, MockProvider, GeminiProvider, GrsAiProvider],
  exports: [ProviderRegistry]
})
export class ProvidersModule {}
