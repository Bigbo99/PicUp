import { Global, Module } from '@nestjs/common';
import { AiConfigService } from './ai-config.service';

@Global()
@Module({
  providers: [AiConfigService],
  exports: [AiConfigService]
})
export class AiConfigModule {}
