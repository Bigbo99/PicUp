import { Module } from '@nestjs/common';
import { FilesModule } from './modules/files/files.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ModelsModule } from './modules/models/models.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { DatabaseModule } from './common/database/database.module';
import { QueueModule } from './common/queue/queue.module';

@Module({
  imports: [DatabaseModule, QueueModule, AuthModule, FilesModule, JobsModule, ModelsModule, ProvidersModule, AdminModule]
})
export class AppModule {}
