import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ProvidersModule } from '../providers/providers.module';
import { ModelsModule } from '../models/models.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ProvidersModule, ModelsModule, AuthModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService]
})
export class JobsModule {}
