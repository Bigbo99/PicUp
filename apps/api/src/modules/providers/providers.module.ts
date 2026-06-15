import { Module } from '@nestjs/common';
import { ProviderRegistry } from './provider.registry';
import { MockProvider } from './mock.provider';
import { GeminiProvider } from './gemini.provider';
import { TokenRunProvider } from './tokenrun.provider';

@Module({
  providers: [ProviderRegistry, MockProvider, GeminiProvider, TokenRunProvider],
  exports: [ProviderRegistry]
})
export class ProvidersModule {}
