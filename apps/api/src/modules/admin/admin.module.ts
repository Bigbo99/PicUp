import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModelsModule } from '../models/models.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule, ModelsModule],
  controllers: [AdminController]
})
export class AdminModule {}
