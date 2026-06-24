import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModelsModule } from '../models/models.module';
import { AdminController } from './admin.controller';
import { AdminOriginGuard } from './admin-origin.guard';
import { AdminRateLimitGuard } from './admin-rate-limit.guard';

@Module({
  imports: [AuthModule, ModelsModule],
  controllers: [AdminController],
  providers: [AdminOriginGuard, AdminRateLimitGuard]
})
export class AdminModule {}
