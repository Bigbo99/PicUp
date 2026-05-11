import { Body, Controller, Get, Inject, Param, Patch, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AdminGuard } from '../auth/admin.guard';
import { StorageService } from '../../common/storage.service';
import { ModelsService } from '../models/models.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { UpdateModelConfigDto, UpsertSettingDto } from './dto';

@Controller('api/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ModelsService) private readonly models: ModelsService
  ) {}

  @Get('users')
  async users(@Query('limit') limit?: string) {
    const users = await this.storage.listUsers(Number(limit ?? 50));
    return users.map((user) => this.auth.toPublicUser(user));
  }

  @Get('stats')
  async stats() {
    return this.storage.stats();
  }

  @Get('models')
  async modelConfigs() {
    return this.models.getModels();
  }

  @Patch('models/:id')
  async updateModelConfig(
    @Param('id') id: string,
    @Body() body: UpdateModelConfigDto,
    @Req() req: AuthenticatedRequest
  ) {
    return this.storage.updateModelConfig(id, body, req.authUser.id);
  }

  @Get('settings')
  async settings() {
    return this.storage.listSettings();
  }

  @Put('settings/:key')
  async upsertSetting(
    @Param('key') key: string,
    @Body() body: UpsertSettingDto,
    @Req() req: AuthenticatedRequest
  ) {
    return this.storage.upsertSetting(key, body.value as Prisma.InputJsonObject, req.authUser.id);
  }

  @Get('audit-logs')
  async auditLogs(@Query('limit') limit?: string) {
    return this.storage.listAuditLogs(Number(limit ?? 100));
  }
}
