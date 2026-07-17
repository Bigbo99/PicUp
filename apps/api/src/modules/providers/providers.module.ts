import { Module } from '@nestjs/common';
import { ProviderRegistry } from './provider.registry';
import { MockProvider } from './mock.provider';
import { GrsaiProvider } from './grsai.provider';
import { TokenRunProvider } from './tokenrun.provider';

@Module({
  providers: [ProviderRegistry, MockProvider, GrsaiProvider, TokenRunProvider],
  exports: [ProviderRegistry]
})
export class ProvidersModule {}
