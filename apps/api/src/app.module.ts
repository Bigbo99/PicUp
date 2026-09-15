import { Module } from '@nestjs/common';
import { StudioController } from './modules/jobs/studio.controller';
import { FilesModule } from './modules/files/files.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ModelsModule } from './modules/models/models.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DatabaseModule } from './common/database/database.module';
import { QueueModule } from './common/queue/queue.module';
import { AiConfigModule } from './common/ai-config/ai-config.module';

@Module({
  controllers: [StudioController],
  imports: [AiConfigModule, DatabaseModule, QueueModule, AuthModule, FilesModule, JobsModule, ModelsModule, ProvidersModule, AdminModule, PaymentsModule]
})
export class AppModule {}
