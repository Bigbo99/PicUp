import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthUser,
  ImageJobRecord,
  ImageJobStatus,
  ImageProviderName,
  ImageQuality,
  ImageTemplate,
  ModelConfig,
  UploadedFileRecord,
  UserRole,
  UserStatus
} from '@picup/shared';
import { Prisma, type FileRecord, type ImageJob, type ModelConfig as DbModelConfig, type User } from '@prisma/client';
import { PrismaService } from './database/prisma.service';

export interface StoredUser extends AuthUser {
  passwordHash: string | null;
}

export interface AppSettingRecord {
  key: string;
  value: Prisma.JsonValue;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  action: string;
  target: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  createdAt: string;
}

export interface LocalDbSnapshot {
  files: UploadedFileRecord[];
  jobs: ImageJobRecord[];
  users: StoredUser[];
}

@Injectable()
export class StorageService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async readDb(): Promise<LocalDbSnapshot> {
    const [files, jobs, users] = await Promise.all([
      this.prisma.fileRecord.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.imageJob.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
    ]);
    return {
      files: files.map((file) => this.toUploadedFile(file)),
      jobs: jobs.map((job) => this.toImageJob(job)),
      users: users.map((user) => this.toStoredUser(user))
    };
  }

  async addFile(file: UploadedFileRecord) {
    const created = await this.prisma.fileRecord.create({
      data: {
        id: file.id,
        userId: file.userId,
        url: file.url,
        mimeType: file.mimeType,
        size: file.size,
        width: file.width,
        height: file.height,
        createdAt: new Date(file.createdAt)
      }
    });
    return this.toUploadedFile(created);
  }

  async getFiles(ids: string[], userId?: string) {
    if (ids.length === 0) return [];
    const files = await this.prisma.fileRecord.findMany({
      where: {
        id: { in: ids },
        ...(userId ? { OR: [{ userId }, { userId: null }] } : {})
      }
    });
    const byId = new Map(files.map((file) => [file.id, this.toUploadedFile(file)]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as UploadedFileRecord[];
  }

  async upsertJob(job: ImageJobRecord) {
    const data = this.toJobWriteData(job);
    const saved = await this.prisma.imageJob.upsert({
      where: { id: job.id },
      update: data,
      create: data
    });
    return this.toImageJob(saved);
  }

  async getJob(id: string, userId?: string, includeAll = false) {
    const job = await this.prisma.imageJob.findFirst({
      where: {
        id,
        ...(includeAll || !userId ? {} : { OR: [{ userId }, { userId: null }] })
      }
    });
    return job ? this.toImageJob(job) : null;
  }

  async deleteJob(id: string, userId?: string, includeAll = false) {
    const job = await this.getJob(id, userId, includeAll);
    if (!job) return null;
    await this.prisma.imageJob.delete({ where: { id } });
    return job;
  }

  async listJobs(limit = 20, userId?: string, includeAll = false) {
    const jobs = await this.prisma.imageJob.findMany({
      where: includeAll || !userId ? {} : { OR: [{ userId }, { userId: null }] },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return jobs.map((job) => this.toImageJob(job));
  }

  async getNextQueuedJob() {
    const job = await this.prisma.imageJob.findFirst({
      where: { status: { in: ['queued', 'retrying'] } },
      orderBy: { createdAt: 'asc' }
    });
    return job ? this.toImageJob(job) : null;
  }

  async addUser(user: StoredUser) {
    const saved = await this.prisma.user.create({
      data: {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role,
        status: user.status,
        isGuest: user.isGuest,
        quotaUnlimited: user.quotaUnlimited,
        emailVerifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : undefined,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt)
      }
    });
    return this.toStoredUser(saved);
  }

  async updateUser(user: StoredUser) {
    const saved = await this.prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role,
        status: user.status,
        isGuest: user.isGuest,
        quotaUnlimited: user.quotaUnlimited,
        emailVerifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : null,
        updatedAt: new Date()
      },
      create: {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role,
        status: user.status,
        isGuest: user.isGuest,
        quotaUnlimited: user.quotaUnlimited,
        emailVerifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : undefined,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt)
      }
    });
    return this.toStoredUser(saved);
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return user ? this.toStoredUser(user) : null;
  }

  async getUserByEmail(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    return user ? this.toStoredUser(user) : null;
  }

  async listUsers(limit = 50) {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return users.map((user) => this.toStoredUser(user));
  }

  async updateUserQuotaUnlimited(id: string, quotaUnlimited: boolean, actorId?: string) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) return null;
    const after = await this.prisma.user.update({
      where: { id },
      data: { quotaUnlimited }
    });
    await this.addAuditLog({
      actorId,
      action: 'user.quota_unlimited.update',
      target: `users:${id}`,
      before: this.toStoredUser(before) as unknown as Prisma.JsonObject,
      after: this.toStoredUser(after) as unknown as Prisma.JsonObject
    });
    return this.toStoredUser(after);
  }

  async countDailyJobs(userId: string, datePrefix: string) {
    const start = new Date(`${datePrefix}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return this.prisma.imageJob.count({
      where: {
        userId,
        createdAt: { gte: start, lt: end }
      }
    });
  }

  createStoredUser(input: {
    id: string;
    email: string | null;
    role: UserRole;
    status?: UserStatus;
    isGuest: boolean;
    passwordHash?: string | null;
    quotaUnlimited?: boolean;
    emailVerifiedAt?: string | null;
  }): StoredUser {
    const now = new Date().toISOString();
    return {
      id: input.id,
      email: input.email,
      role: input.role,
      status: input.status ?? 'active',
      isGuest: input.isGuest,
      quotaUnlimited: input.quotaUnlimited ?? false,
      passwordHash: input.passwordHash ?? null,
      emailVerifiedAt: input.emailVerifiedAt ?? undefined,
      createdAt: now,
      updatedAt: now
    };
  }

  async getModelConfigs(defaults: ModelConfig[]) {
    const existing = await this.prisma.modelConfig.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    if (existing.length === 0) {
      await this.seedModelConfigs(defaults);
      return this.prisma.modelConfig.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] })
        .then((models) => models.map((model) => this.toModelConfig(model)));
    }
    const existingKeys = new Set(existing.map((model) => `${model.provider}:${model.model}`));
    const missingDefaults = defaults.filter((model) => !existingKeys.has(`${model.provider}:${model.model}`));
    if (missingDefaults.length > 0) {
      await this.seedModelConfigs(missingDefaults);
      return this.prisma.modelConfig.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] })
        .then((models) => models.map((model) => this.toModelConfig(model)));
    }
    return existing.map((model) => this.toModelConfig(model));
  }

  async seedModelConfigs(defaults: ModelConfig[]) {
    await Promise.all(defaults.map((model, index) =>
      this.prisma.modelConfig.upsert({
        where: { provider_model: { provider: model.provider, model: model.model } },
        update: {},
        create: {
          provider: model.provider,
          model: model.model,
          displayName: model.displayName,
          description: model.description,
          enabled: model.enabled,
          priority: model.priority ?? index + 1,
          maxInputImages: model.maxInputImages,
          supportedRatios: model.supportedRatios,
          supportedQualities: model.supportedQualities,
          costCredits: model.costCredits
        }
      })
    ));
  }

  async updateModelConfig(id: string, input: Partial<ModelConfig>, actorId?: string) {
    const before = await this.prisma.modelConfig.findUnique({ where: { id } });
    if (!before) return null;
    const after = await this.prisma.modelConfig.update({
      where: { id },
      data: {
        displayName: input.displayName,
        description: input.description,
        enabled: input.enabled,
        priority: input.priority,
        maxInputImages: input.maxInputImages,
        supportedRatios: input.supportedRatios,
        supportedQualities: input.supportedQualities,
        costCredits: input.costCredits
      }
    });
    await this.addAuditLog({
      actorId,
      action: 'model_config.update',
      target: `model_configs:${id}`,
      before: this.toModelConfig(before) as unknown as Prisma.JsonObject,
      after: this.toModelConfig(after) as unknown as Prisma.JsonObject
    });
    return this.toModelConfig(after);
  }

  async listSettings() {
    const settings = await this.prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
    return settings.map((setting) => ({
      key: setting.key,
      value: setting.value,
      updatedBy: setting.updatedBy,
      createdAt: setting.createdAt.toISOString(),
      updatedAt: setting.updatedAt.toISOString()
    }));
  }

  async upsertSetting(key: string, value: Prisma.InputJsonValue, actorId?: string) {
    const before = await this.prisma.appSetting.findUnique({ where: { key } });
    const after = await this.prisma.appSetting.upsert({
      where: { key },
      update: { value, updatedBy: actorId },
      create: { key, value, updatedBy: actorId }
    });
    await this.addAuditLog({
      actorId,
      action: 'app_setting.upsert',
      target: `app_settings:${key}`,
      before: before ? ({ key: before.key, value: before.value } as Prisma.JsonObject) : null,
      after: { key: after.key, value: after.value } as Prisma.JsonObject
    });
    return {
      key: after.key,
      value: after.value,
      updatedBy: after.updatedBy,
      createdAt: after.createdAt.toISOString(),
      updatedAt: after.updatedAt.toISOString()
    };
  }

  async listAuditLogs(limit = 100) {
    const logs = await this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return logs.map((log) => ({
      id: log.id,
      actorId: log.actorId,
      action: log.action,
      target: log.target,
      before: log.before,
      after: log.after,
      createdAt: log.createdAt.toISOString()
    }));
  }

  async stats() {
    const [users, files, jobs, failedJobs, succeededJobs, settings, auditLogs] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.fileRecord.count(),
      this.prisma.imageJob.count(),
      this.prisma.imageJob.count({ where: { status: 'failed' } }),
      this.prisma.imageJob.count({ where: { status: 'succeeded' } }),
      this.prisma.appSetting.count(),
      this.prisma.auditLog.count()
    ]);
    return { users, files, jobs, failedJobs, succeededJobs, settings, auditLogs };
  }

  private async addAuditLog(input: {
    actorId?: string;
    action: string;
    target: string;
    before: Prisma.InputJsonValue | null;
    after: Prisma.InputJsonValue | null;
  }) {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        target: input.target,
        before: input.before ?? undefined,
        after: input.after ?? undefined
      }
    });
  }

  private toUploadedFile(file: FileRecord): UploadedFileRecord {
    return {
      id: file.id,
      userId: file.userId ?? undefined,
      url: file.url,
      mimeType: file.mimeType,
      size: file.size,
      width: file.width ?? undefined,
      height: file.height ?? undefined,
      createdAt: file.createdAt.toISOString()
    };
  }

  private toStoredUser(user: User): StoredUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      isGuest: user.isGuest,
      quotaUnlimited: user.quotaUnlimited,
      passwordHash: user.passwordHash,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    };
  }

  private toImageJob(job: ImageJob): ImageJobRecord {
    return {
      id: job.id,
      userId: job.userId ?? undefined,
      mode: job.mode as ImageJobRecord['mode'],
      provider: job.provider as ImageProviderName,
      model: job.model,
      template: job.template as ImageTemplate,
      prompt: job.prompt,
      imageIds: this.jsonArray<string>(job.imageIds),
      aspectRatio: job.aspectRatio,
      quality: job.quality as ImageQuality,
      status: job.status as ImageJobStatus,
      selectedProvider: job.selectedProvider as Exclude<ImageProviderName, 'auto'>,
      selectedModel: job.selectedModel,
      finalPrompt: job.finalPrompt,
      inputFiles: this.jsonArray<UploadedFileRecord>(job.inputFiles),
      outputImages: this.jsonArray<ImageJobRecord['outputImages'][number]>(job.outputImages),
      textOutputs: this.jsonArray<string>(job.textOutputs),
      error: job.error as ImageJobRecord['error'],
      creditsReserved: job.creditsReserved,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString()
    };
  }

  private toJobWriteData(job: ImageJobRecord): Prisma.ImageJobUncheckedCreateInput {
    return {
      id: job.id,
      userId: job.userId,
      mode: job.mode,
      provider: job.provider,
      model: job.model,
      template: job.template,
      prompt: job.prompt,
      imageIds: job.imageIds,
      aspectRatio: job.aspectRatio,
      quality: job.quality,
      status: job.status,
      selectedProvider: job.selectedProvider,
      selectedModel: job.selectedModel,
      finalPrompt: job.finalPrompt,
      inputFiles: job.inputFiles as unknown as Prisma.InputJsonValue,
      outputImages: job.outputImages as unknown as Prisma.InputJsonValue,
      textOutputs: job.textOutputs as unknown as Prisma.InputJsonValue,
      error: job.error as unknown as Prisma.InputJsonValue,
      creditsReserved: job.creditsReserved,
      createdAt: new Date(job.createdAt),
      updatedAt: new Date(job.updatedAt),
      completedAt: job.completedAt ? new Date(job.completedAt) : null
    };
  }

  private toModelConfig(model: DbModelConfig): ModelConfig {
    return {
      id: model.id,
      provider: model.provider as Exclude<ImageProviderName, 'auto'>,
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      enabled: model.enabled,
      priority: model.priority,
      maxInputImages: model.maxInputImages,
      supportedRatios: this.jsonArray<string>(model.supportedRatios),
      supportedQualities: this.jsonArray<ImageQuality>(model.supportedQualities),
      costCredits: model.costCredits
    };
  }

  private jsonArray<T>(value: Prisma.JsonValue): T[] {
    return Array.isArray(value) ? value as T[] : [];
  }
}
