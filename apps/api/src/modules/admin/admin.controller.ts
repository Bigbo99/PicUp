import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ObjectStorageService } from '../../common/object-storage.service';
import { Prisma } from '@prisma/client';
import type { ImageJobStatus, UserRole, UserStatus } from '@picup/shared';
import { AuthService } from '../auth/auth.service';
import { AdminGuard } from '../auth/admin.guard';
import { AdminOriginGuard } from './admin-origin.guard';
import { AdminRateLimitGuard } from './admin-rate-limit.guard';
import { StorageService } from '../../common/storage.service';
import { clientIp } from '../../common/request-ip';
import { ModelsService } from '../models/models.service';
import { AiConfigService } from '../../common/ai-config/ai-config.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import {
  CreateAiModelDto,
  CreateAiProviderDto,
  UpdateAiMockDto,
  UpdateAiModelDto,
  UpdateAiProviderDto,
  UpdateAiRoutingDto,
  UpdateModelConfigDto,
  UpdateUserCreditsDto,
  UpdateUserDto,
  UpdateUserQuotaDto,
  UpdateUserStatusDto,
  UpsertSettingDto
} from './dto';

@Controller('api/admin')
@UseGuards(AdminGuard, AdminRateLimitGuard, AdminOriginGuard)
export class AdminController {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ModelsService) private readonly models: ModelsService,
    @Inject(AiConfigService) private readonly aiConfig: AiConfigService,
    @Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService
  ) {}

  @Get('users')
  async users(
    @Query('query') query?: string,
    @Query('role') role?: UserRole,
    @Query('status') status?: UserStatus,
    @Query('isGuest') isGuest?: string,
    @Query('quotaUnlimited') quotaUnlimited?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    const result = await this.storage.listUsersFiltered({
      query,
      role: this.userRole(role),
      status: this.userStatus(status),
      isGuest: this.optionalBoolean(isGuest),
      quotaUnlimited: this.optionalBoolean(quotaUnlimited),
      cursor,
      limit: Number(limit ?? 50)
    });
    return {
      users: result.users.map((user) => this.auth.toPublicUser(user)),
      nextCursor: result.nextCursor
    };
  }

  @Patch('users/:id/quota')
  async updateUserQuota(
    @Param('id') id: string,
    @Body() body: UpdateUserQuotaDto,
    @Req() req: AuthenticatedRequest
  ) {
    const user = await this.storage.updateUserQuotaUnlimited(id, body.quotaUnlimited, req.authUser.id, this.auditMetadata(req));
    return user ? this.auth.toPublicUser(user) : null;
  }

  @Patch('users/:id')
  async updateUser(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
    @Req() req: AuthenticatedRequest
  ) {
    const target = await this.storage.getUserById(id);
    if (!target) throw new NotFoundException('用户不存在');
    const actorIsSuperAdmin = this.auth.isSuperAdmin(req.authUser);
    const targetIsSuperAdmin = this.auth.isSuperAdmin(target);
    if (targetIsSuperAdmin && id !== req.authUser.id) {
      throw new BadRequestException('超级管理员不可被其他账号修改');
    }
    if (targetIsSuperAdmin && body.role && body.role !== 'admin') {
      throw new BadRequestException('超级管理员角色不可降级');
    }
    if (body.role && body.role !== target.role && !actorIsSuperAdmin) {
      throw new BadRequestException('只有超级管理员可以调整用户角色');
    }
    if (id === req.authUser.id && body.status && body.status !== 'active') {
      throw new BadRequestException('不能禁用当前登录的管理员');
    }
    const user = await this.storage.updateUserAdmin(id, {
      displayName: body.displayName,
      email: body.email,
      role: body.role,
      status: body.status,
      quotaUnlimited: body.quotaUnlimited,
      creditBalance: body.creditBalance
    }, req.authUser.id, this.auditMetadata(req));
    if (!user) throw new NotFoundException('用户不存在');
    return this.auth.toPublicUser(user);
  }

  @Patch('users/:id/ip-lookup')
  async refreshUserIp(
    @Param('id') id: string
  ) {
    const target = await this.storage.getUserById(id);
    if (!target) throw new NotFoundException('用户不存在');
    if (!target.lastIp) throw new BadRequestException('该用户暂无可查询的 IP');
    const metadata = await this.auth.lookupIp(target.lastIp);
    const user = await this.storage.enrichUserIp(id, metadata);
    if (!user) throw new NotFoundException('用户不存在');
    return this.auth.toPublicUser(user);
  }

  @Patch('users/:id/status')
  async updateUserStatus(
    @Param('id') id: string,
    @Body() body: UpdateUserStatusDto,
    @Req() req: AuthenticatedRequest
  ) {
    if (id === req.authUser.id && body.status !== 'active') {
      throw new BadRequestException('不能禁用当前登录的管理员');
    }
    const target = await this.storage.getUserById(id);
    if (target && this.auth.isSuperAdmin(target) && id !== req.authUser.id) {
      throw new BadRequestException('超级管理员不可被禁用');
    }
    const user = await this.storage.updateUserStatus(id, body.status, req.authUser.id, body.reason, this.auditMetadata(req));
    if (!user) throw new NotFoundException('用户不存在');
    return this.auth.toPublicUser(user);
  }

  @Patch('users/:id/credits')
  async updateUserCredits(
    @Param('id') id: string,
    @Body() body: UpdateUserCreditsDto,
    @Req() req: AuthenticatedRequest
  ) {
    const user = await this.storage.adjustUserCredits(id, body.delta, req.authUser.id, body.reason, this.auditMetadata(req));
    if (!user) throw new BadRequestException('用户不存在，或调整后余额不能为负数');
    return this.auth.toPublicUser(user);
  }

  @Delete('users/:id')
  async deleteUser(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest
  ) {
    if (id === req.authUser.id) {
      throw new BadRequestException('不能删除当前登录的管理员');
    }
    const target = await this.storage.getUserById(id);
    if (target?.role === 'admin' && !this.auth.isSuperAdmin(req.authUser)) {
      throw new BadRequestException('只有超级管理员可以删除管理员账号');
    }
    if (target && this.auth.isSuperAdmin(target)) {
      throw new BadRequestException('超级管理员不可删除');
    }
    const user = await this.storage.deleteUser(id, req.authUser.id, this.auditMetadata(req));
    if (!user) throw new NotFoundException('用户不存在');
    return this.auth.toPublicUser(user);
  }

  @Get('stats')
  async stats() {
    return this.storage.stats();
  }

  @Get('overview')
  async overview(@Query('range') range?: string) {
    return this.storage.overview(range ?? '24h');
  }

  @Get('jobs')
  async jobs(
    @Query('status') status?: ImageJobStatus,
    @Query('provider') provider?: string,
    @Query('model') model?: string,
    @Query('userId') userId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return this.storage.listJobsFiltered({
      status: this.jobStatus(status),
      provider,
      model,
      userId,
      cursor,
      limit: Number(limit ?? 50)
    });
  }

  @Get('jobs/:id')
  async job(@Param('id') id: string) {
    const job = await this.storage.getJob(id, undefined, true);
    if (!job) throw new NotFoundException('任务不存在');
    return job;
  }

  @Get('jobs/:id/media/:kind/:index')
  async jobMedia(@Param('id') id: string, @Param('kind') kind: string, @Param('index') index: string, @Res() res: Response) {
    const job = await this.storage.getJob(id, undefined, true);
    if (!job || !/^\d+$/.test(index)) throw new NotFoundException('图片不存在');
    const file = kind === 'input' ? job.inputFiles[Number(index)] : kind === 'output' ? job.outputImages[Number(index)] : kind === 'mask' && index === '0' ? job.maskFile : undefined;
    if (!file) throw new NotFoundException('图片不存在');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(await this.objectStorage.readByUrl(file.url));
  }

  @Get('models')
  async modelConfigs() {
    return this.models.getModels();
  }

  @Patch('models/:id')
  async updateModelConfig(
    @Param('id') id: string,
    @Body() body: UpdateModelConfigDto
  ) {
    const separator = id.indexOf(':');
    if (separator <= 0) throw new BadRequestException('模型 id 格式错误');
    return this.aiConfig.updateModel(id.slice(0, separator), id.slice(separator + 1), body);
  }

  @Get('ai-config')
  aiConfiguration() {
    return this.aiConfig.adminConfig();
  }

  @Post('ai-config/providers')
  createAiProvider(@Body() body: CreateAiProviderDto) {
    return this.aiConfig.createProvider(body);
  }

  @Patch('ai-config/providers/:providerId')
  updateAiProvider(@Param('providerId') providerId: string, @Body() body: UpdateAiProviderDto) {
    return this.aiConfig.updateProvider(providerId, body);
  }

  @Delete('ai-config/providers/:providerId')
  deleteAiProvider(@Param('providerId') providerId: string) {
    return this.aiConfig.deleteProvider(providerId);
  }

  @Post('ai-config/providers/:providerId/models')
  createAiModel(@Param('providerId') providerId: string, @Body() body: CreateAiModelDto) {
    return this.aiConfig.createModel(providerId, body);
  }

  @Patch('ai-config/providers/:providerId/models/:modelId')
  updateAiModel(
    @Param('providerId') providerId: string,
    @Param('modelId') modelId: string,
    @Body() body: UpdateAiModelDto
  ) {
    return this.aiConfig.updateModel(providerId, modelId, body);
  }

  @Delete('ai-config/providers/:providerId/models/:modelId')
  deleteAiModel(@Param('providerId') providerId: string, @Param('modelId') modelId: string) {
    return this.aiConfig.deleteModel(providerId, modelId);
  }

  @Patch('ai-config/routing')
  updateAiRouting(@Body() body: UpdateAiRoutingDto) {
    return this.aiConfig.updateRouting(body);
  }

  @Patch('ai-config/mock')
  updateAiMock(@Body() body: UpdateAiMockDto) {
    return this.aiConfig.setMockEnabled(body.mockEnabled);
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
    return this.storage.upsertSetting(key, body.value as Prisma.InputJsonObject, req.authUser.id, this.auditMetadata(req));
  }

  @Get('audit-logs')
  async auditLogs(
    @Query('action') action?: string,
    @Query('target') target?: string,
    @Query('actorId') actorId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return this.storage.listAuditLogsFiltered({
      action,
      target,
      actorId,
      cursor,
      limit: Number(limit ?? 100)
    });
  }

  @Get('providers/health')
  async providerHealth() {
    return this.aiConfig.providerHealth();
  }

  private optionalBoolean(value?: string) {
    if (value === undefined || value === '') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }

  private userRole(value?: string) {
    return value === 'guest' || value === 'user' || value === 'admin' ? value : undefined;
  }

  private userStatus(value?: string) {
    return value === 'pending' || value === 'active' || value === 'disabled' ? value : undefined;
  }

  private jobStatus(value?: string) {
    return value === 'queued' || value === 'running' || value === 'retrying' || value === 'succeeded' || value === 'failed' || value === 'refunded'
      ? value
      : undefined;
  }

  private auditMetadata(req: AuthenticatedRequest) {
    const requestId = req.headers['x-request-id'];
    return {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    };
  }
}
