import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthUser,
  ImageJobRecord,
  ImageJobStatus,
  ImageProviderName,
  ImageQuality,
  ImageTemplate,
  ModelConfig,
  PaymentOrderResponse,
  UploadedFileRecord,
  UserRole,
  UserStatus
} from '@picup/shared';
import { Prisma, type FileRecord, type ImageJob, type ModelConfig as DbModelConfig, type PaymentOrder, type User } from '@prisma/client';
import { redactAuditValue } from './audit-redaction';
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
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  createdAt: string;
}

export interface AuditMetadata {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface VisitorMetadata {
  ip?: string;
  country?: string;
  region?: string;
  city?: string;
}

export interface UserListFilters {
  query?: string;
  role?: UserRole;
  status?: UserStatus;
  isGuest?: boolean;
  quotaUnlimited?: boolean;
  cursor?: string;
  limit?: number;
}

export interface JobListFilters {
  status?: ImageJobStatus;
  provider?: string;
  model?: string;
  userId?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditLogFilters {
  action?: string;
  target?: string;
  actorId?: string;
  cursor?: string;
  limit?: number;
}

export interface AdminUserUpdateInput {
  displayName?: string | null;
  email?: string | null;
  role?: Exclude<UserRole, 'guest'>;
  status?: UserStatus;
  quotaUnlimited?: boolean;
  creditBalance?: number;
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
      this.prisma.imageJob.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
    ]);
    return {
      files: files.map((file) => this.toUploadedFile(file)),
      jobs: jobs.map((job) => this.toImageJob(job)),
      users: users.map((user) => this.toStoredUser(user))
    };
  }

  async addFile(file: UploadedFileRecord) {
    const created = file.hash && file.userId
      ? await this.prisma.fileRecord.upsert({
          where: {
            userId_hash: {
              userId: file.userId,
              hash: file.hash
            }
          },
          update: {
            url: file.url,
            mimeType: file.mimeType,
            size: file.size,
            width: file.width,
            height: file.height
          },
          create: {
            purpose: file.purpose ?? 'user',
            id: file.id,
            userId: file.userId,
            hash: file.hash,
            url: file.url,
            mimeType: file.mimeType,
            size: file.size,
            width: file.width,
            height: file.height,
            createdAt: new Date(file.createdAt)
          }
        })
      : await this.prisma.fileRecord.create({
          data: {
            purpose: file.purpose ?? 'user',
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

  async findFileByHash(hash: string, userId?: string) {
    const file = await this.prisma.fileRecord.findFirst({
      where: userId ? { hash, userId } : { hash }
    });
    return file ? this.toUploadedFile(file) : null;
  }

  async transferGuestFiles(guestId: string, userId: string) {
    if (guestId === userId) return;
    await this.serializable(async (tx) => {
      const guest = await tx.user.findUnique({ where: { id: guestId } });
      const owner = await tx.user.findUnique({ where: { id: userId } });
      if (!guest?.isGuest || guest.status !== 'active' || !owner || owner.isGuest || owner.status !== 'active') return;
      const files = await tx.fileRecord.findMany({ where: { userId: guestId }, select: { id: true, hash: true } });
      const hashes = files.flatMap(file => file.hash ? [file.hash] : []);
      const duplicates = await tx.fileRecord.findMany({ where: { userId, hash: { in: hashes } }, select: { hash: true } });
      const duplicateHashes = new Set(duplicates.map(file => file.hash));
      // Keep draft and subject file IDs valid when the account already owns the same bytes.
      const duplicateIds = files.filter(file => file.hash && duplicateHashes.has(file.hash)).map(file => file.id);
      if (duplicateIds.length) await tx.fileRecord.updateMany({ where: { id: { in: duplicateIds }, userId: guestId }, data: { hash: null } });
      await tx.fileRecord.updateMany({ where: { userId: guestId }, data: { userId } });
      await tx.studioSubject.updateMany({ where: { userId: guestId }, data: { userId } });
      // Remove only empty anonymous accounts after their uploads have been transferred.
      const payments = await tx.paymentOrder.count({ where: { userId: guestId } });
      const credits = await tx.creditEntry.count({ where: { userId: guestId } });
      if (!payments && !credits) {
        await tx.user.deleteMany({ where: {
          id: guestId, isGuest: true, creditBalance: 0,
          email: null, passwordHash: null,
          files: { none: {} }, subjects: { none: {} }, jobs: { none: {} },
          auditLogs: { none: {} }, identities: { none: {} },
          emailChallenges: { none: {} }, wechatSessions: { none: {} },
          studioPreference: null, assetMetadata: { none: {} }, conversationMetadata: { none: {} }
        } });
      }
    });
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

  async getFileByInputFilename(filename: string, userId: string) {
    const hash = filename.replace(/\.[A-Za-z0-9]+$/, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    return this.findFileByHash(hash, userId);
  }

  async getJobByIdempotency(userId: string, idempotencyKey: string) {
    const job = await this.prisma.imageJob.findFirst({ where: { userId, idempotencyKey, deletedAt: null } });
    return job ? this.toImageJob(job) : null;
  }

  async claimJob(id: string, leaseOwner: string, leaseMs: number) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const result = await this.prisma.imageJob.updateMany({
      where: {
        id,
        attempt: { lt: this.maxJobAttempts() },
        OR: [
          { status: { in: ['queued', 'retrying'] } },
          { status: 'running', OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }
        ]
      },
      data: {
        status: 'running',
        attempt: { increment: 1 },
        leaseOwner,
        leaseExpiresAt,
        updatedAt: now
      }
    });
    if (result.count !== 1) {
      const exhausted = await this.serializable(async (tx) => {
        const current = await tx.imageJob.findUnique({ where: { id } });
        if (!current || current.attempt < this.maxJobAttempts()) return null;
        const eligible = current.status === 'queued' || current.status === 'retrying'
          || (current.status === 'running' && Boolean(current.leaseExpiresAt && current.leaseExpiresAt <= now));
        return eligible ? this.settleFailedJob(tx, current, '任务重试次数已达上限，已停止继续调用模型') : null;
      });
      return exhausted ? this.toImageJob(exhausted) : null;
    }
    return this.getJob(id);
  }

  async requeueJobs(ids: string[], leaseOwner: string) {
    if (!ids.length) return false;
    const updated = await this.prisma.imageJob.updateMany({
      where: { id: { in: ids }, status: 'running', leaseOwner },
      data: {
        status: 'retrying',
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date()
      }
    });
    return updated.count > 0;
  }

  async renewJobLease(id: string, leaseOwner: string, leaseMs: number) {
    const now = new Date();
    const updated = await this.prisma.imageJob.updateMany({
      where: { id, status: 'running', leaseOwner, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) }
    });
    return updated.count === 1;
  }

  async updateJobExecutionRoute(job: ImageJobRecord, leaseOwner: string) {
    const current = await this.prisma.imageJob.findFirst({ where: { id: job.id, status: 'running', leaseOwner }, select: { editOptions: true } });
    if (!current) return false;
    const editOptions = (current.editOptions && typeof current.editOptions === 'object' && !Array.isArray(current.editOptions))
      ? { ...(current.editOptions as Record<string, unknown>), providerRoute: job.providerRoute }
      : { providerRoute: job.providerRoute };
    const updated = await this.prisma.imageJob.updateMany({
      where: { id: job.id, status: 'running', leaseOwner },
      data: { selectedProvider: job.selectedProvider, selectedModel: job.selectedModel, editOptions: editOptions as Prisma.InputJsonValue, updatedAt: new Date() }
    });
    return updated.count === 1;
  }

  async completeJob(job: ImageJobRecord, leaseOwner: string) {
    return this.serializable(async (tx) => {
      const current = await tx.imageJob.findUnique({ where: { id: job.id } });
      if (!current || current.status !== 'running' || current.leaseOwner !== leaseOwner
        || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) return null;
      const count = current.count;
      if (count > 1 && (job.outputImages.length < 1 || job.outputImages.length > count)) {
        throw new Error('批量结果数量无效');
      }
      const missing = Math.max(0, count - job.outputImages.length);
      const refund = count > 1 && current.paymentMode === 'credits' && current.userId
        ? Math.floor(current.creditsReserved * missing / count) : 0;
      const updated = await tx.imageJob.updateMany({
        where: { id: job.id, status: 'running', leaseOwner, leaseExpiresAt: { gt: new Date() } },
        data: this.toJobWriteData({ ...job, count, creditsReserved: current.creditsReserved, creditsRefunded: refund })
      });
      if (updated.count !== 1) return null;
      // Publish the successful images and compensate missing ones in one transaction.
      if (refund > 0 && current.userId) {
        await tx.user.update({ where: { id: current.userId }, data: { creditBalance: { increment: refund } } });
        await tx.creditEntry.create({ data: {
          key: `job:${current.id}:refund`, userId: current.userId, kind: 'refund', delta: refund
        } });
      }
      const saved = await tx.imageJob.findUniqueOrThrow({ where: { id: job.id } });
      return this.toImageJob(saved);
    });
  }

  async updateJobProgress(job: ImageJobRecord, leaseOwner: string) {
    const data = this.toJobWriteData(job);
    const updated = await this.prisma.imageJob.updateMany({
      where: { id: job.id, status: 'running', leaseOwner, leaseExpiresAt: { gt: new Date() } },
      data: { outputImages: data.outputImages, textOutputs: data.textOutputs, editOptions: data.editOptions, updatedAt: new Date() }
    });
    return updated.count === 1;
  }

  private async serializable<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(action, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          // Recovery runs alongside job consumers. Give a contended transaction
          // time to acquire a connection/lock before treating it as a failure.
          maxWait: 10_000,
          timeout: 30_000
        });
      } catch (error) {
        // P2002 is retried for concurrent idempotency-key winners so the next
        // transaction can observe and return the job created by the winner.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2028', 'P2034', 'P2002'].includes(error.code) || attempt >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt + Math.random() * 100));
      }
    }
  }

  async hasEnoughCredits(userId: string, credits: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { creditBalance: true } });
    return Boolean(user && user.creditBalance >= credits);
  }

  async createJobWithReservation(job: ImageJobRecord, freeUnlimited = false) {
    return this.serializable(async (tx) => {
      if (job.userId && job.idempotencyKey) {
        const existing = await tx.imageJob.findFirst({ where: { userId: job.userId, idempotencyKey: job.idempotencyKey, deletedAt: null } });
        if (existing) return { job: this.toImageJob(existing), created: false };
      }

      const count = job.count ?? 1;
      if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('生成数量必须为 1 至 4 张');
      if (count > 1 && job.paymentMode !== 'credits' && !(job.paymentMode === 'free' && freeUnlimited)) {
        throw new Error('批量生成请使用积分支付');
      }

      if (job.paymentMode === 'credits' && job.userId && job.creditsReserved > 0) {
        const debited = await tx.user.updateMany({
          where: { id: job.userId, creditBalance: { gte: job.creditsReserved } },
          data: { creditBalance: { decrement: job.creditsReserved } }
        });
        if (debited.count !== 1) throw new Error('积分不足，请充值后再生成');
      }

      if (job.paymentMode === 'free' && job.userId && !freeUnlimited) {
        const start = new Date(`${job.createdAt.slice(0, 10)}T00:00:00.000Z`);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        const used = await tx.imageJob.count({ where: {
          userId: job.userId,
          paymentMode: 'free',
          createdAt: { gte: start, lt: end },
          status: { notIn: ['failed', 'refunded'] }
        } });
        if (used >= 1) throw new Error('今日免费次数已用完，请先充值积分');
      }

      if (job.paymentMode === 'single' && job.paymentOrderId && job.userId) {
        const order = await tx.paymentOrder.findFirst({
          where: { id: job.paymentOrderId, userId: job.userId, orderType: 'single_job', status: 'paid' }
        });
        if (!order) throw new Error('Single payment order is invalid or unpaid');
      }

      const created = await tx.imageJob.create({ data: this.toJobWriteData(job) });
      if (job.userId) await tx.creditEntry.create({ data: {
        key: `job:${job.id}:reserve`, userId: job.userId, kind: job.paymentMode ?? 'free',
        delta: job.paymentMode === 'credits' ? -job.creditsReserved : 0, createdAt: new Date(job.createdAt)
      } });
      return { job: this.toImageJob(created), created: true };
    });
  }

  async failJob(job: ImageJobRecord, leaseOwner: string) {
    return this.serializable(async (tx) => {
      const current = await tx.imageJob.findUnique({ where: { id: job.id } });
      if (!current || current.status !== 'running' || current.leaseOwner !== leaseOwner
        || !current.leaseExpiresAt || current.leaseExpiresAt <= new Date()) {
        return null;
      }

      const saved = await this.settleFailedJob(tx, current, job.error?.message);
      return this.toImageJob(saved);
    });
  }

  async listRecoverableJobIds(take = 200) {
    const jobs = await this.prisma.imageJob.findMany({
      where: { status: { in: ['queued', 'retrying'] }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: Math.max(1, Math.min(1000, Math.floor(take)))
    });
    return jobs.map((job) => job.id);
  }

  async requeueExpiredJobs() {
    const now = new Date();
    await this.serializable(async (tx) => {
      const expired = await tx.imageJob.findMany({
        where: {
          status: 'running',
          deletedAt: null,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }]
        },
        orderBy: { updatedAt: 'asc' },
        take: 200
      });
      for (const job of expired) {
        if (job.attempt >= this.maxJobAttempts()) {
          await this.settleFailedJob(tx, job, '任务租约已过期且重试次数已达上限');
          continue;
        }
        await tx.imageJob.updateMany({
          where: { id: job.id, status: 'running' },
          data: { status: 'retrying', leaseOwner: null, leaseExpiresAt: null, updatedAt: now }
        });
      }
    });
  }

  private maxJobAttempts() {
    const configured = Number(process.env.IMAGE_JOB_MAX_ATTEMPTS);
    return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 20) : 3;
  }

  private async settleFailedJob(tx: Prisma.TransactionClient, current: ImageJob, message = '模型服务暂时不可用') {
    const completed = this.jsonArray<ImageJobRecord['outputImages'][number]>(current.outputImages).length;
    const partial = current.count > 1 && completed > 0;
    const refund = partial ? Math.floor(current.creditsReserved * Math.max(0, current.count - completed) / current.count) : current.creditsReserved;
    const compensatesBalance = current.paymentMode === 'credits'
      && Boolean(current.userId)
      && refund > 0;
    const edit = (current.editOptions ?? {}) as Partial<ImageJobRecord>;
    const saved = await tx.imageJob.update({
      where: { id: current.id },
      data: {
        status: partial ? 'succeeded' : compensatesBalance ? 'refunded' : 'failed',
        creditsRefunded: compensatesBalance ? refund : 0,
        editOptions: { ...edit, outputProgress: edit.outputProgress?.map(slot => slot.status === 'succeeded' ? slot : { status: 'failed' }) } as unknown as Prisma.InputJsonValue,
        error: partial && completed === current.count ? Prisma.DbNull : {
          code: partial ? 'BATCH_PARTIAL_FAILURE' : current.attempt >= this.maxJobAttempts() ? 'MAX_ATTEMPTS_EXCEEDED' : 'PROVIDER_UNAVAILABLE',
          message
        },
        leaseOwner: null,
        leaseExpiresAt: null,
        paymentOrderId: current.paymentMode === 'single' ? null : current.paymentOrderId,
        completedAt: new Date(),
        updatedAt: new Date()
      }
    });
    if (current.userId && compensatesBalance) {
      await tx.user.update({
        where: { id: current.userId },
        data: { creditBalance: { increment: refund } }
      });
      await tx.creditEntry.create({ data: {
        key: `job:${current.id}:refund`,
        userId: current.userId,
        kind: 'refund',
        delta: refund
      } });
    }
    return saved;
  }

  async getJob(id: string, userId?: string, includeAll = false) {
    const job = await this.prisma.imageJob.findFirst({
      where: {
        id,
        ...(userId && !includeAll ? { deletedAt: null } : {}),
        ...(includeAll || !userId ? {} : { OR: [{ userId }, { userId: null }] })
      }
    });
    return job ? this.toImageJob(job) : null;
  }

  async deleteJob(id: string, userId?: string, includeAll = false) {
    const job = await this.getJob(id, userId, includeAll);
    if (!job) return null;
    await this.prisma.imageJob.update({ where: { id }, data: { deletedAt: new Date() } });
    return job;
  }

  async listJobs(limit = 20, userId?: string, includeAll = false, cursor?: string, query?: string, status?: string) {
    const jobs = await this.prisma.imageJob.findMany({
      where: {
        ...(includeAll || !userId ? {} : { userId, deletedAt: null }),
        ...(query ? { prompt: { contains: query, mode: 'insensitive' as const } } : {}),
        ...(status === 'active' ? { status: { in: ['queued', 'running', 'retrying'] as ImageJobStatus[] } }
          : status === 'failed' ? { status: { in: ['failed', 'refunded'] as ImageJobStatus[] } }
          : status === 'succeeded' ? { status: 'succeeded' as const } : {})
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: this.normalizedLimit(limit, 20, 100)
    });
    return jobs.map((job) => this.toImageJob(job));
  }

  async getNextQueuedJob() {
    const job = await this.prisma.imageJob.findFirst({
      where: { status: { in: ['queued', 'retrying'] }, deletedAt: null },
      orderBy: { createdAt: 'asc' }
    });
    return job ? this.toImageJob(job) : null;
  }

  async addUser(user: StoredUser) {
    const saved = await this.prisma.user.create({
      data: {
        id: user.id,
        email: user.email,
        ...(user.displayName !== undefined ? { displayName: user.displayName } : {}),
        passwordHash: user.passwordHash,
        role: user.role,
        status: user.status,
        isGuest: user.isGuest,
        quotaUnlimited: user.quotaUnlimited,
        creditBalance: user.creditBalance,
        lastIp: user.lastIp,
        lastCountry: user.lastCountry,
        lastRegion: user.lastRegion,
        lastCity: user.lastCity,
        lastSeenAt: user.lastSeenAt ? new Date(user.lastSeenAt) : undefined,
        emailVerifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : undefined,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt)
      }
    });
    return this.toStoredUser(saved);
  }

  async updateUser(id: string, patch: Partial<Pick<StoredUser,
    'email' | 'displayName' | 'passwordHash' | 'isGuest' | 'role'
  >> & { emailVerifiedAt?: string | null }) {
    // Authentication updates must never write back a balance, status or quota
    // read before a concurrent payment or administrator change.
    const saved = await this.prisma.user.update({
      where: { id, status: 'active' },
      data: {
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.passwordHash !== undefined ? { passwordHash: patch.passwordHash } : {}),
        ...(patch.emailVerifiedAt !== undefined ? { emailVerifiedAt: patch.emailVerifiedAt ? new Date(patch.emailVerifiedAt) : null } : {}),
        ...(patch.isGuest !== undefined ? { isGuest: patch.isGuest } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {})
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

  async listUsersFiltered(filters: UserListFilters = {}) {
    const limit = this.normalizedLimit(filters.limit, 50, 100);
    const query = filters.query?.trim();
    const where: Prisma.UserWhereInput = {
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(typeof filters.isGuest === 'boolean' ? { isGuest: filters.isGuest } : {}),
      ...(typeof filters.quotaUnlimited === 'boolean' ? { quotaUnlimited: filters.quotaUnlimited } : {}),
      ...(query ? {
        OR: [
          { id: this.uuidOrNever(query) },
          { email: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } }
        ]
      } : {})
    };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });
    return {
      users: users.slice(0, limit).map((user) => this.toStoredUser(user)),
      nextCursor: users.length > limit ? users[limit - 1].id : undefined
    };
  }

  async updateUserQuotaUnlimited(id: string, quotaUnlimited: boolean, actorId?: string, metadata?: AuditMetadata) {
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
    }, metadata);
    return this.toStoredUser(after);
  }

  async updateUserStatus(id: string, status: UserStatus, actorId?: string, reason?: string, metadata?: AuditMetadata) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) return null;
    const after = await this.prisma.user.update({
      where: { id },
      data: { status }
    });
    await this.addAuditLog({
      actorId,
      action: 'user.status.update',
      target: `users:${id}`,
      before: { ...this.toStoredUser(before), reason: reason ?? null } as unknown as Prisma.JsonObject,
      after: { ...this.toStoredUser(after), reason: reason ?? null } as unknown as Prisma.JsonObject
    }, metadata);
    return this.toStoredUser(after);
  }

  async adjustUserCredits(id: string, delta: number, actorId?: string, reason?: string, metadata?: AuditMetadata) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) return null;
    if (before.creditBalance + delta < 0) return null;
    const after = await this.prisma.user.update({
      where: { id },
      data: { creditBalance: { increment: delta } }
    });
    await this.addAuditLog({
      actorId,
      action: 'user.credits.adjust',
      target: `users:${id}`,
      before: { ...this.toStoredUser(before), delta, reason: reason ?? null } as unknown as Prisma.JsonObject,
      after: { ...this.toStoredUser(after), delta, reason: reason ?? null } as unknown as Prisma.JsonObject
    }, metadata);
    return this.toStoredUser(after);
  }

  async deleteUser(id: string, actorId?: string, metadata?: AuditMetadata) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) return null;
    const deleted = await this.prisma.user.delete({ where: { id } });
    await this.addAuditLog({
      actorId,
      action: 'user.delete',
      target: `users:${id}`,
      before: this.toStoredUser(before) as unknown as Prisma.JsonObject,
      after: null
    }, metadata);
    return this.toStoredUser(deleted);
  }

  async countDailyJobs(userId: string, datePrefix: string) {
    const start = new Date(`${datePrefix}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return this.prisma.imageJob.count({
      where: {
        userId,
        paymentMode: 'free',
        createdAt: { gte: start, lt: end },
        status: { notIn: ['failed', 'refunded'] }
      }
    });
  }

  createStoredUser(input: {
    id: string;
    email: string | null;
    displayName?: string | null;
    role: UserRole;
    status?: UserStatus;
    isGuest: boolean;
    passwordHash?: string | null;
    quotaUnlimited?: boolean;
    creditBalance?: number;
    emailVerifiedAt?: string | null;
    visitor?: VisitorMetadata;
  }): StoredUser {
    const now = new Date().toISOString();
    return {
      id: input.id,
      email: input.email,
      displayName: input.displayName ?? null,
      role: input.role,
      status: input.status ?? 'active',
      isGuest: input.isGuest,
      quotaUnlimited: input.quotaUnlimited ?? false,
      creditBalance: input.creditBalance ?? 0,
      passwordHash: input.passwordHash ?? null,
      emailVerifiedAt: input.emailVerifiedAt ?? undefined,
      lastIp: input.visitor?.ip ?? null,
      lastCountry: input.visitor?.country ?? null,
      lastRegion: input.visitor?.region ?? null,
      lastCity: input.visitor?.city ?? null,
      lastSeenAt: input.visitor?.ip ? now : null,
      createdAt: now,
      updatedAt: now
    };
  }

  async updateGuestVisit(id: string, visitor: VisitorMetadata) {
    if (!visitor.ip && !visitor.country && !visitor.region && !visitor.city) return;
    await this.prisma.user.updateMany({
      where: { id, isGuest: true },
      data: {
        ...(visitor.ip ? { lastIp: visitor.ip } : {}),
        ...(visitor.country ? { lastCountry: visitor.country } : {}),
        ...(visitor.region ? { lastRegion: visitor.region } : {}),
        ...(visitor.city ? { lastCity: visitor.city } : {}),
        lastSeenAt: new Date()
      }
    });
  }

  async updateUserAdmin(id: string, input: AdminUserUpdateInput, actorId?: string, metadata?: AuditMetadata) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) return null;
    const after = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName?.trim() || null } : {}),
        ...(input.email !== undefined ? { email: input.email?.trim().toLowerCase() || null } : {}),
        ...(input.role ? { role: input.role, isGuest: false } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(typeof input.quotaUnlimited === 'boolean' ? { quotaUnlimited: input.quotaUnlimited } : {}),
        ...(typeof input.creditBalance === 'number' ? { creditBalance: input.creditBalance } : {})
      }
    });
    await this.addAuditLog({
      actorId,
      action: 'user.profile.update',
      target: `users:${id}`,
      before: this.toStoredUser(before) as unknown as Prisma.JsonObject,
      after: this.toStoredUser(after) as unknown as Prisma.JsonObject
    }, metadata);
    return this.toStoredUser(after);
  }

  async enrichUserIp(id: string, visitor: VisitorMetadata) {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: {
          ...(visitor.ip ? { lastIp: visitor.ip } : {}),
          ...(visitor.country ? { lastCountry: visitor.country } : {}),
          ...(visitor.region ? { lastRegion: visitor.region } : {}),
          ...(visitor.city ? { lastCity: visitor.city } : {}),
          lastSeenAt: new Date()
        }
      });
      return this.toStoredUser(user);
    } catch (error) {
      // Keep the previous updateMany semantics: a deleted user is not an error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return null;
      throw error;
    }
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

  async updateModelConfig(id: string, input: Partial<ModelConfig>, actorId?: string, metadata?: AuditMetadata) {
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
    }, metadata);
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

  async upsertSetting(key: string, value: Prisma.InputJsonValue, actorId?: string, _metadata?: AuditMetadata) {
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
      before: redactAuditValue(log.before),
      after: redactAuditValue(log.after),
      createdAt: log.createdAt.toISOString()
    }));
  }

  async listAuditLogsFiltered(filters: AuditLogFilters = {}) {
    const limit = this.normalizedLimit(filters.limit, 100, 200);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        ...(filters.action ? { action: { contains: filters.action, mode: 'insensitive' } } : {}),
        ...(filters.target ? { target: { contains: filters.target, mode: 'insensitive' } } : {}),
        ...(filters.actorId ? { actorId: filters.actorId } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });
    return {
      logs: logs.slice(0, limit).map((log) => ({
        id: log.id,
        actorId: log.actorId,
        action: log.action,
        target: log.target,
        before: redactAuditValue(log.before),
        after: redactAuditValue(log.after),
        ip: log.ip,
        userAgent: log.userAgent,
        requestId: log.requestId,
        createdAt: log.createdAt.toISOString()
      })),
      nextCursor: logs.length > limit ? logs[limit - 1].id : undefined
    };
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

  async overview(range: string) {
    const since = this.rangeStart(range);
    const [
      users,
      guests,
      registeredUsers,
      admins,
      activeUsers,
      disabledUsers,
      pendingUsers,
      files,
      jobs,
      settings,
      auditLogs,
      queued,
      running,
      retrying,
      succeeded,
      failed,
      refunded,
      rangeCreated,
      modelGroups,
      recentFailures
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isGuest: true } }),
      this.prisma.user.count({ where: { isGuest: false } }),
      this.prisma.user.count({ where: { role: 'admin' } }),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { status: 'disabled' } }),
      this.prisma.user.count({ where: { status: 'pending' } }),
      this.prisma.fileRecord.count(),
      this.prisma.imageJob.count(),
      this.prisma.appSetting.count(),
      this.prisma.auditLog.count(),
      this.prisma.imageJob.count({ where: { status: 'queued' } }),
      this.prisma.imageJob.count({ where: { status: 'running' } }),
      this.prisma.imageJob.count({ where: { status: 'retrying' } }),
      this.prisma.imageJob.count({ where: { status: 'succeeded', ...(since ? { createdAt: { gte: since } } : {}) } }),
      this.prisma.imageJob.count({ where: { status: 'failed', ...(since ? { createdAt: { gte: since } } : {}) } }),
      this.prisma.imageJob.count({ where: { status: 'refunded', ...(since ? { createdAt: { gte: since } } : {}) } }),
      this.prisma.imageJob.count({ where: since ? { createdAt: { gte: since } } : {} }),
      this.prisma.imageJob.groupBy({
        by: ['selectedProvider', 'selectedModel', 'status'],
        _count: { _all: true },
        where: since ? { createdAt: { gte: since } } : undefined
      }),
      this.prisma.imageJob.findMany({
        where: {
          status: { in: ['failed', 'refunded'] },
          ...(since ? { completedAt: { gte: since } } : {})
        },
        orderBy: { completedAt: 'desc' },
        take: 8
      })
    ]);
    const byModel = new Map<string, { provider: string; model: string; jobs: number; succeeded: number; failed: number }>();
    for (const group of modelGroups) {
      const key = `${group.selectedProvider}:${group.selectedModel}`;
      const current = byModel.get(key) ?? {
        provider: group.selectedProvider,
        model: group.selectedModel,
        jobs: 0,
        succeeded: 0,
        failed: 0
      };
      current.jobs += group._count._all;
      if (group.status === 'succeeded') current.succeeded += group._count._all;
      if (group.status === 'failed' || group.status === 'refunded') current.failed += group._count._all;
      byModel.set(key, current);
    }
    const completed = succeeded + failed + refunded;
    return {
      totals: {
        users,
        guests,
        registeredUsers,
        admins,
        activeUsers,
        disabledUsers,
        pendingUsers,
        files,
        jobs,
        settings,
        auditLogs
      },
      guestGeo: [],
      jobs: {
        queued,
        running,
        retrying,
        succeeded,
        failed,
        refunded,
        successRate: completed > 0 ? Math.round((succeeded / completed) * 1000) / 10 : 0,
        rangeCreated
      },
      models: [...byModel.values()].sort((left, right) => right.jobs - left.jobs),
      recentFailures: recentFailures.map((job) => this.toImageJob(job))
    };
  }

  async listJobsFiltered(filters: JobListFilters = {}) {
    const limit = this.normalizedLimit(filters.limit, 50, 100);
    const jobs = await this.prisma.imageJob.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.provider ? { selectedProvider: filters.provider } : {}),
        ...(filters.model ? { selectedModel: filters.model } : {}),
        ...(filters.userId ? { userId: filters.userId } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });
    return {
      jobs: jobs.slice(0, limit).map((job) => this.toImageJob(job)),
      nextCursor: jobs.length > limit ? jobs[limit - 1].id : undefined
    };
  }

  async debitCredits(userId: string, credits: number) {
    const updated = await this.prisma.user.updateMany({
      where: {
        id: userId,
        creditBalance: { gte: credits }
      },
      data: {
        creditBalance: { decrement: credits }
      }
    });
    return updated.count === 1;
  }

  async creditUser(userId: string, credits: number) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { creditBalance: { increment: credits } }
    });
    return this.toStoredUser(user);
  }

  async createPaymentOrder(input: {
    id: string;
    userId: string;
    externalOrderId: string;
    orderType: 'credit_recharge' | 'single_job';
    amountCents: number;
    credits: number;
    metadata?: Prisma.InputJsonValue;
  }) {
    const order = await this.prisma.paymentOrder.create({
      data: {
        id: input.id,
        userId: input.userId,
        externalOrderId: input.externalOrderId,
        orderType: input.orderType,
        amountCents: input.amountCents,
        credits: input.credits,
        metadata: input.metadata
      }
    });
    return this.toPaymentOrder(order);
  }

  async getPaymentOrder(id: string, userId?: string) {
    const order = await this.prisma.paymentOrder.findFirst({
      where: {
        id,
        ...(userId ? { userId } : {})
      }
    });
    return order ? this.toPaymentOrder(order) : null;
  }

  async getPaymentOrderExternalId(id: string) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id },
      select: { externalOrderId: true }
    });
    return order?.externalOrderId ?? null;
  }

  async setPaymentCheckoutUrl(id: string, checkoutUrl: string) {
    const order = await this.prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
    const metadata = order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata) ? order.metadata : {};
    const updated = await this.prisma.paymentOrder.update({ where: { id }, data: { metadata: { ...metadata, checkoutUrl } } });
    return this.toPaymentOrder(updated);
  }

  async getPaymentOrderByExternalId(externalOrderId: string) {
    const order = await this.prisma.paymentOrder.findUnique({ where: { externalOrderId } });
    return order ? this.toPaymentOrder(order) : null;
  }

  async isPaymentOrderUsed(paymentOrderId: string) {
    const count = await this.prisma.imageJob.count({ where: { paymentOrderId } });
    return count > 0;
  }

  async accountActivity(userId: string) {
    const [entries, orders] = await Promise.all([
      this.prisma.creditEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.paymentOrder.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })
    ]);
    return { entries: entries.map(entry => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
      orders: orders.map(order => this.toPaymentOrder(order)) };
  }

  async markPaymentOrderPaid(externalOrderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findUnique({ where: { externalOrderId } });
      if (!order) return null;
      if (order.status === 'paid') return this.toPaymentOrder(order);

      const claimed = await tx.paymentOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: {
          status: 'paid',
          paidAt: new Date()
        }
      });

      const paid = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (claimed.count !== 1) return this.toPaymentOrder(paid);

      if (paid.userId && paid.orderType === 'credit_recharge' && paid.credits > 0) {
        await tx.user.update({
          where: { id: paid.userId },
          data: { creditBalance: { increment: paid.credits } }
        });
        await tx.creditEntry.create({ data: {
          key: `order:${paid.id}`, userId: paid.userId, kind: 'recharge', delta: paid.credits
        } });
      }

      return this.toPaymentOrder(paid);
    });
  }

  private async addAuditLog(input: {
    actorId?: string;
    action: string;
    target: string;
    before: Prisma.InputJsonValue | null;
    after: Prisma.InputJsonValue | null;
  }, metadata?: AuditMetadata) {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        target: input.target,
        before: redactAuditValue(input.before) ?? undefined,
        after: redactAuditValue(input.after) ?? undefined,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
        requestId: metadata?.requestId
      }
    });
  }

  private toUploadedFile(file: FileRecord): UploadedFileRecord {
    return {
      purpose: file.purpose as UploadedFileRecord['purpose'],
      id: file.id,
      userId: file.userId ?? undefined,
      hash: file.hash ?? undefined,
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
      displayName: 'displayName' in user && typeof user.displayName === 'string' ? user.displayName : null,
      role: user.role,
      status: user.status,
      isGuest: user.isGuest,
      quotaUnlimited: user.quotaUnlimited,
      creditBalance: user.creditBalance,
      passwordHash: user.passwordHash,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString(),
      lastIp: user.lastIp,
      lastCountry: user.lastCountry,
      lastRegion: user.lastRegion,
      lastCity: user.lastCity,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString()
    };
  }

  private toImageJob(job: ImageJob): ImageJobRecord {
    const edit = job.editOptions as Partial<ImageJobRecord> | null;
    return {
      previewOperation: edit?.previewOperation,
      guideFileId: edit?.guideFileId,
      editComments: edit?.editComments,
      systemFileIds: edit?.systemFileIds,
      confirmedCredits: edit?.confirmedCredits,
      quotedSelection: edit?.quotedSelection,
      maskFileId: edit?.maskFileId,
      background: edit?.background,
      maskFile: edit?.maskFile,
      providerRoute: edit?.providerRoute,
      outputProgress: edit?.outputProgress,
      width: edit?.width,
      height: edit?.height,
      id: job.id,
      userId: job.userId ?? undefined,
      mode: job.mode as ImageJobRecord['mode'],
      provider: job.provider as ImageProviderName,
      model: job.model,
      template: job.template as ImageTemplate,
      prompt: job.prompt,
      promptParts: job.promptParts ? this.jsonArray<NonNullable<ImageJobRecord['promptParts']>[number]>(job.promptParts) : undefined,
      imageIds: this.jsonArray<string>(job.imageIds),
      aspectRatio: job.aspectRatio,
      quality: job.quality as ImageQuality,
      count: job.count,
      status: job.status as ImageJobStatus,
      selectedProvider: job.selectedProvider as Exclude<ImageProviderName, 'auto'>,
      selectedModel: job.selectedModel,
      finalPrompt: job.finalPrompt,
      inputFiles: this.jsonArray<UploadedFileRecord>(job.inputFiles),
      outputImages: this.jsonArray<ImageJobRecord['outputImages'][number]>(job.outputImages),
      textOutputs: this.jsonArray<string>(job.textOutputs),
      error: job.error as ImageJobRecord['error'],
      creditsReserved: job.creditsReserved,
      creditsRefunded: job.creditsRefunded,
      paymentMode: job.paymentMode as ImageJobRecord['paymentMode'],
      paymentOrderId: job.paymentOrderId,
      idempotencyKey: job.idempotencyKey ?? undefined,
      parentJobId: job.parentJobId ?? undefined,
      attempt: job.attempt,
      leaseOwner: job.leaseOwner,
      leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString()
    };
  }

  private toJobWriteData(job: ImageJobRecord): Prisma.ImageJobUncheckedCreateInput {
    return {
      editOptions: { maskFileId: job.maskFileId, background: job.background, maskFile: job.maskFile, previewOperation: job.previewOperation, guideFileId: job.guideFileId, editComments: job.editComments, systemFileIds: job.systemFileIds, confirmedCredits: job.confirmedCredits, quotedSelection: job.quotedSelection, providerRoute: job.providerRoute, outputProgress: job.outputProgress, width: job.width, height: job.height } as unknown as Prisma.InputJsonValue,
      id: job.id,
      userId: job.userId,
      mode: job.mode,
      provider: job.provider,
      model: job.model,
      template: job.template,
      prompt: job.prompt,
      promptParts: job.promptParts as unknown as Prisma.InputJsonValue | undefined,
      imageIds: job.imageIds,
      aspectRatio: job.aspectRatio,
      quality: job.quality,
      count: job.count ?? 1,
      status: job.status,
      selectedProvider: job.selectedProvider,
      selectedModel: job.selectedModel,
      finalPrompt: job.finalPrompt,
      inputFiles: job.inputFiles as unknown as Prisma.InputJsonValue,
      outputImages: job.outputImages as unknown as Prisma.InputJsonValue,
      textOutputs: job.textOutputs as unknown as Prisma.InputJsonValue,
      error: job.error as unknown as Prisma.InputJsonValue,
      creditsReserved: job.creditsReserved,
      creditsRefunded: job.creditsRefunded ?? 0,
      paymentMode: job.paymentMode ?? 'free',
      paymentOrderId: job.paymentOrderId ?? null,
      idempotencyKey: job.idempotencyKey ?? null,
      parentJobId: job.parentJobId ?? null,
      attempt: job.attempt ?? 0,
      leaseOwner: job.leaseOwner ?? null,
      leaseExpiresAt: job.leaseExpiresAt ? new Date(job.leaseExpiresAt) : null,
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

  private toPaymentOrder(order: PaymentOrder): PaymentOrderResponse {
    return {
      id: order.id,
      status: order.status as PaymentOrderResponse['status'],
      orderType: order.orderType as PaymentOrderResponse['orderType'],
      amountCents: order.amountCents,
      credits: order.credits,
      codeUrl: this.metadataString(order.metadata, 'codeUrl'),
      checkoutUrl: this.metadataString(order.metadata, 'checkoutUrl'),
      paymentProvider: this.metadataString(order.metadata, 'paymentProvider'),
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString()
    };
  }

  private metadataString(metadata: Prisma.JsonValue, key: string) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }

  private jsonArray<T>(value: Prisma.JsonValue): T[] {
    return Array.isArray(value) ? value as T[] : [];
  }

  private normalizedLimit(value: number | undefined, fallback: number, max: number) {
    const limit = Number(value ?? fallback);
    if (!Number.isFinite(limit) || limit <= 0) return fallback;
    return Math.min(Math.floor(limit), max);
  }

  private uuidOrNever(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      ? value
      : '00000000-0000-0000-0000-000000000000';
  }

  private rangeStart(range: string) {
    const now = Date.now();
    if (range === '7d') return new Date(now - 7 * 24 * 60 * 60 * 1000);
    if (range === '30d') return new Date(now - 30 * 24 * 60 * 60 * 1000);
    if (range === 'all') return null;
    return new Date(now - 24 * 60 * 60 * 1000);
  }
}
