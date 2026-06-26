import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ImageJobStatus, ImageProviderName, UserRole, UserStatus } from '@picup/shared';
import { AuthService } from '../auth/auth.service';
import { AdminGuard } from '../auth/admin.guard';
import { AdminOriginGuard } from './admin-origin.guard';
import { AdminRateLimitGuard } from './admin-rate-limit.guard';
import { StorageService } from '../../common/storage.service';
import { ModelsService } from '../models/models.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { UpdateModelConfigDto, UpdateUserCreditsDto, UpdateUserDto, UpdateUserQuotaDto, UpdateUserStatusDto, UpsertSettingDto } from './dto';

@Controller('api/admin')
@UseGuards(AdminGuard, AdminRateLimitGuard, AdminOriginGuard)
export class AdminController {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ModelsService) private readonly models: ModelsService
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
    return this.storage.updateModelConfig(id, body, req.authUser.id, this.auditMetadata(req));
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
    const models = (await this.models.getModels()).models;
    return {
      providers: (['gemini', 'tokenrun'] satisfies Array<Exclude<ImageProviderName, 'auto'>>).map((provider) => {
        const enabledModels = models.filter((model) => model.provider === provider && model.enabled).length;
        const configured = provider === 'gemini'
          ? Boolean(process.env.GEMINI_API_KEY || process.env.PROVIDER_MOCK_ENABLED !== 'false')
          : Boolean(process.env.TOKENRUN_API_KEY || process.env.PROVIDER_MOCK_ENABLED !== 'false');
        return {
          provider,
          configured,
          enabledModels,
          lastCheckedAt: new Date().toISOString(),
          status: configured && enabledModels > 0 ? 'healthy' : enabledModels > 0 ? 'degraded' : 'disabled',
          message: configured ? undefined : `${provider} 密钥未配置`
        };
      })
    };
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
    const forwardedFor = req.headers['x-forwarded-for'];
    const requestId = req.headers['x-request-id'];
    return {
      ip: Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0]?.trim() || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    };
  }
}
