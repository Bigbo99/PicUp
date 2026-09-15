import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ImageJobCreateRequest,
  ImageJobCreateResponse,
  ImageJobRecord,
  JobQuote,
  PaymentOrderResponse,
  AuthUser
} from '@picup/shared';
import { detectImageIntent } from '@picup/shared';
import { StorageService } from '../../common/storage.service';
import { RedisQueueService } from '../../common/queue/redis-queue.service';
import { ModelsService } from '../models/models.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { buildFinalPrompt } from './prompt-builder';
import { compilePromptParts, subjectReferences } from './prompt-parts';
import { PrismaService } from '../../common/database/prisma.service';
import { ObjectStorageService } from '../../common/object-storage.service';
import { PaymentsService } from '../payments/payments.service';
import { AiConfigService } from '../../common/ai-config/ai-config.service';
import type { ProviderSlotLease } from '../../common/queue/redis-queue.service';

type ReservedPayment =
  | { mode: 'free' | 'credits' | 'single'; orderId: string | null }
  | { mode: 'single_pending'; order: PaymentOrderResponse };

@Injectable()
export class JobsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StorageService)
    private readonly storage: StorageService,
    @Inject(RedisQueueService)
    private readonly queue: RedisQueueService,
    @Inject(ModelsService)
    private readonly models: ModelsService,
    @Inject(ProviderRegistry)
    private readonly providers: ProviderRegistry,
    @Inject(ObjectStorageService)
    private readonly objectStorage: ObjectStorageService,
    @Inject(PaymentsService)
    private readonly payments: PaymentsService,
    @Inject(AiConfigService)
    private readonly aiConfig: AiConfigService
  ) {}

  async create(input: ImageJobCreateRequest, user: AuthUser): Promise<ImageJobCreateResponse> {
    if (!input.prompt?.trim()) throw new BadRequestException('请输入 P 图需求');
    if (input.mode === 'edit' && input.imageIds.length === 0) {
      throw new BadRequestException('图片编辑需要先上传图片');
    }

    if (input.idempotencyKey) {
      const existing = await this.storage.getJobByIdempotency(user.id, input.idempotencyKey);
      if (existing) {
        if (existing.status === 'queued' || existing.status === 'retrying') {
          await this.enqueueCommittedJob(existing.id);
        }
        return {
          jobId: existing.id,
          status: existing.status,
          creditsReserved: existing.creditsReserved,
          paymentMode: existing.paymentMode
        };
      }
    }

    const compiled = compilePromptParts(input);
    input = { ...input, imageIds: compiled.imageIds };
    const subjectNotes: string[] = [];
    for (const ref of subjectReferences(input.promptParts)) {
      const subject = await this.db.studioSubject.findFirst({ where: { id: ref.subjectId, userId: user.id, fileId: ref.fileId } });
      if (!subject) throw new BadRequestException('主体不存在或已删除，请重新引用');
      if (subject.description) subjectNotes.push(`图片 ${input.imageIds.indexOf(ref.fileId) + 1} 的主体描述：${subject.description}`);
    }
    const inputFiles = await this.storage.getFiles(input.imageIds, user.id);
    if (inputFiles.length !== input.imageIds.length) {
      throw new BadRequestException('上传图片不存在或已过期');
    }
    if (input.promptParts && inputFiles.some(file => file.userId !== user.id || !file.mimeType.startsWith('image/'))) throw new BadRequestException('引用图片不可用');
    if (input.parentJobId) {
      const parent = await this.storage.getJob(input.parentJobId, user.id);
      if (!parent || parent.userId !== user.id || parent.status !== 'succeeded') {
        throw new BadRequestException('原任务不可用于继续编辑');
      }
    }

    const resolvedInput: ImageJobCreateRequest = {
      ...input,
      template: input.template === 'auto'
        ? detectImageIntent(input.prompt, input.imageIds.length > 0).template
        : input.template
    };
    const selection = await this.selectProvider(resolvedInput);
    const payment = await this.reservePayment(user, resolvedInput, selection.costCredits);
    if (payment.mode === 'single_pending') {
      return {
        paymentRequired: true,
        paymentOrder: payment.order
      };
    }
    const finalPrompt = buildFinalPrompt(resolvedInput.template, [compiled.prompt, ...new Set(subjectNotes)].join('\n'));
    const now = new Date().toISOString();
    const job: ImageJobRecord = {
      ...resolvedInput,
      id: randomUUID(),
      userId: user.id,
      status: 'queued',
      selectedProvider: selection.provider,
      selectedModel: selection.model,
      finalPrompt,
      inputFiles,
      outputImages: [],
      textOutputs: [],
      error: null,
      creditsReserved: selection.costCredits,
      paymentMode: payment.mode,
      paymentOrderId: payment.orderId,
      idempotencyKey: resolvedInput.idempotencyKey,
      attempt: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now
    };

    let reservedJob;
    try {
      reservedJob = await this.storage.createJobWithReservation(
        job,
        user.role === 'admin' || user.quotaUnlimited
      );
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '任务额度预占失败');
    }
    if (!reservedJob.created) {
      if (reservedJob.job.status === 'queued' || reservedJob.job.status === 'retrying') {
        await this.enqueueCommittedJob(reservedJob.job.id);
      }
      return {
        jobId: reservedJob.job.id,
        status: reservedJob.job.status,
        creditsReserved: reservedJob.job.creditsReserved,
        paymentMode: reservedJob.job.paymentMode
      };
    }
    await this.enqueueCommittedJob(job.id);
    return { jobId: job.id, status: job.status, creditsReserved: job.creditsReserved, paymentMode: payment.mode };
  }

  async get(id: string, user?: AuthUser) {
    const job = await this.storage.getJob(id, user?.id, false);
    if (!job) throw new NotFoundException('任务不存在');
    return job;
  }

  async downloadOutput(id: string, outputIndex: number, user: AuthUser) {
    const job = await this.storage.getJob(id, user.id, false);
    if (!job) throw new NotFoundException('任务不存在');
    const output = job.outputImages[outputIndex];
    if (!output) throw new NotFoundException('下载文件不存在');
    const body = await this.objectStorage.readByUrl(output.url);
    const extension = this.extensionForMimeType(output.mimeType) ?? this.extensionFromUrl(output.url);
    return {
      body,
      mimeType: output.mimeType || 'application/octet-stream',
      filename: `picup-${job.id}-${outputIndex + 1}${extension}`
    };
  }

  async quote(input: ImageJobCreateRequest, user: AuthUser): Promise<JobQuote> {
    const resolved = { ...input, template: input.template === 'auto'
      ? detectImageIntent(input.prompt, input.imageIds.length > 0).template : input.template };
    const selection = await this.selectProvider(resolved);
    try {
      const payment = await this.reservePayment(user, { ...resolved, paymentMode: input.paymentMode === 'credits' ? 'credits' : undefined }, selection.costCredits);
      return { paymentMode: payment.mode === 'credits' ? 'credits' : 'free',
        credits: payment.mode === 'credits' ? selection.costCredits : 0, available: true };
    } catch (error) {
      return { paymentMode: 'credits', credits: selection.costCredits, available: false,
        reason: error instanceof Error ? error.message : '暂时无法生成' };
    }
  }

  async referenceOutput(id: string, index: number, user: AuthUser) {
    const job = await this.get(id, user);
    const output = job.outputImages[index];
    if (job.userId !== user.id || job.status !== 'succeeded' || !output) throw new BadRequestException('结果图片不存在');
    const body = await this.objectStorage.readByUrl(output.url);
    const hash = createHash('sha256').update(body).digest('hex');
    const existing = await this.storage.findFileByHash(hash, user.id);
    if (existing) return existing;
    const extension = this.extensionForMimeType(output.mimeType);
    if (!extension) throw new BadRequestException('该结果格式不支持继续编辑');
    const url = await this.objectStorage.save('inputs', `${hash}${extension}`, body, output.mimeType);
    return this.storage.addFile({ id: randomUUID(), userId: user.id, hash, url,
      mimeType: output.mimeType, size: body.length, width: output.width, height: output.height,
      createdAt: new Date().toISOString() });
  }

  async list(limit = 20, user?: AuthUser, cursor?: string, query?: string, status?: string) {
    return this.storage.listJobs(limit, user?.id, false, cursor, query, status);
  }

  async delete(id: string, user: AuthUser) {
    const deleted = await this.storage.deleteJob(id, user.id, false);
    if (!deleted) throw new NotFoundException('任务不存在');
    return { ok: true, jobId: id };
  }

  async processNext() {
    const jobId = await this.queue.dequeueJob();
    if (!jobId) return null;

    const leaseOwner = `${process.pid}:${randomUUID()}`;
    const claimed = await this.storage.claimJob(jobId, leaseOwner, this.jobLeaseMs());
    if (!claimed) {
      await this.queue.ackJob(jobId);
      return null;
    }
    if (claimed.status !== 'running') {
      await this.ackTerminalJob(jobId);
      return claimed;
    }

    try {
      return await this.process(claimed.id, leaseOwner);
    } catch (error) {
      const requeued = await this.storage.requeueJobs([jobId], leaseOwner).catch((storageError) => {
        console.error(`[job] ${jobId} database requeue failed`, storageError);
        return false;
      });
      if (requeued) await this.queue.requeueJob(jobId).catch((requeueError) => {
        console.error(`[job] ${jobId} requeue failed`, requeueError);
      });
      throw error;
    }
  }

  async process(id: string, leaseOwner?: string) {
    const job = await this.storage.getJob(id);
    if (!job) throw new NotFoundException('任务不存在');
    if (!leaseOwner && job.status !== 'queued' && job.status !== 'retrying') return job;

    const running = leaseOwner ? job : await this.storage.claimJob(id, `${process.pid}:${randomUUID()}`, this.jobLeaseMs());
    if (!running) return job;
    const owner = running.leaseOwner!;
    if (leaseOwner && owner !== leaseOwner) return running;
    console.log(`[job] ${running.id} running provider=${running.selectedProvider} model=${running.selectedModel}`);

    let lease: ProviderSlotLease | undefined;
    let leaseLost = false;
    let renewing = false;
    let renewalPromise: Promise<void> | null = null;
    const heartbeat = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      renewalPromise = (async () => {
        try {
          if (!await this.storage.renewJobLease(id, owner, this.jobLeaseMs())) leaseLost = true;
          if (lease && !await this.queue.renewProviderSlot(lease)) leaseLost = true;
        } catch (error) {
          leaseLost = true;
          console.error(`[job] ${id} lease renewal failed`, error);
        } finally { renewing = false; }
      })();
      await renewalPromise;
    }, 10_000);
    heartbeat.unref();
    try {
      const providerConfig = this.aiConfig.getProvider(running.selectedProvider);
      lease = await this.queue.acquireProviderSlot(
        providerConfig.id,
        providerConfig.concurrency,
        providerConfig.rpm,
        providerConfig.timeoutMs
      );
      if (leaseLost || !await this.storage.renewJobLease(id, owner, this.jobLeaseMs())) {
        const requeued = await this.storage.requeueJobs([id], owner);
        if (requeued) await this.queue.requeueJob(id);
        return await this.storage.getJob(id);
      }
      const provider = this.providers.get(running.selectedProvider);
      const result = await provider.generate({
        jobId: running.id,
        outputKey: `${running.id}-${running.attempt ?? 0}`,
        provider: running.selectedProvider,
        mode: running.mode,
        template: running.template,
        automaticModelSelection: running.provider === 'auto' || running.model === 'auto',
        prompt: running.finalPrompt,
        model: running.selectedModel,
        aspectRatio: running.aspectRatio,
        quality: running.quality,
        images: running.inputFiles
      });
      if (renewalPromise) await renewalPromise;
      const leaseStillOwned = !leaseLost && await this.storage.renewJobLease(id, owner, this.jobLeaseMs());
      if (!leaseStillOwned) {
        await Promise.allSettled(result.images.map((image) => this.objectStorage.deleteByUrl(image.url)));
        const requeued = await this.storage.requeueJobs([id], owner);
        if (requeued) await this.queue.requeueJob(id);
        return await this.storage.getJob(id);
      }
      const completed: ImageJobRecord = {
        ...running,
        status: 'succeeded',
        leaseOwner: null,
        leaseExpiresAt: null,
        outputImages: result.images,
        textOutputs: result.textOutputs,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      const saved = await this.storage.completeJob(completed, owner);
      if (saved && ['succeeded', 'failed', 'refunded'].includes(saved.status)) await this.ackTerminalJob(completed.id);
      if (!saved) {
        await Promise.allSettled(result.images.map((image) => this.objectStorage.deleteByUrl(image.url)));
        return await this.storage.getJob(id);
      }
      console.log(`[job] ${completed.id} succeeded outputs=${completed.outputImages.length}`);
      return saved;
    } catch (error) {
      const latest = await this.storage.getJob(running.id);
      if (latest?.status === 'succeeded') {
        await this.ackTerminalJob(latest.id);
        return latest;
      }
      if (leaseLost) {
        const requeued = await this.storage.requeueJobs([id], owner).catch(() => false);
        if (requeued) await this.queue.requeueJob(id).catch(() => undefined);
        return await this.storage.getJob(id);
      }
      const failed: ImageJobRecord = {
        ...running,
        status: 'failed',
        leaseOwner: null,
        leaseExpiresAt: null,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: error instanceof Error ? error.message : '模型服务暂时不可用'
        },
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      const terminal = await this.storage.failJob(failed, owner);
      if (!terminal) return await this.storage.getJob(id);
      if (terminal && ['succeeded', 'failed', 'refunded'].includes(terminal.status)) await this.ackTerminalJob(failed.id);
      console.error(`[job] ${failed.id} failed ${failed.error?.code}: ${failed.error?.message}`);
      return terminal ?? failed;
    } finally {
      clearInterval(heartbeat);
      if (renewalPromise) await renewalPromise;
      if (lease) {
        await this.queue.releaseProviderSlot(lease).catch((error) => {
          console.error(`[job] ${running.id} provider slot release failed`, error);
        });
      }
    }
  }

  async restoreQueuedJobs() {
    await this.storage.requeueExpiredJobs();
    const recoverable = await this.storage.listRecoverableJobIds(200);
    for (const jobId of recoverable) await this.queue.requeueJob(jobId);
  }

  private async enqueueCommittedJob(jobId: string) {
    await this.queue.enqueueJob(jobId).catch((error) => {
      // The persisted queued job is the durable outbox; the worker reconciles it periodically.
      console.error(`[job] ${jobId} enqueue deferred to reconciliation`, error);
    });
  }

  private async ackTerminalJob(jobId: string) {
    await this.queue.ackJob(jobId).catch((error) => {
      console.error(`[job] ${jobId} terminal ack failed`, error);
    });
  }

  private jobLeaseMs() {
    const configured = Number(process.env.IMAGE_JOB_LEASE_MS);
    return Number.isFinite(configured) && configured >= 60_000 ? configured : 20 * 60 * 1000;
  }

  private async selectProvider(input: ImageJobCreateRequest) {
    const selection = this.models.resolveSelection(input);
    if (input.imageIds.length > selection.model.maxInputImages) {
      throw new BadRequestException(`当前模型最多支持 ${selection.model.maxInputImages} 张参考图`);
    }
    if (!selection.model.supportedRatios.includes(input.aspectRatio)) {
      throw new BadRequestException(`当前模型不支持 ${input.aspectRatio} 图片比例`);
    }
    if (!selection.model.supportedQualities.includes(input.quality)) {
      throw new BadRequestException(`当前模型不支持 ${input.quality} 分辨率`);
    }
    return {
      provider: selection.provider.id,
      model: selection.model.model,
      costCredits: selection.model.costCredits
    };
  }

  private async reservePayment(user: AuthUser, input: ImageJobCreateRequest, costCredits: number): Promise<ReservedPayment> {
    if (user.isGuest) {
      throw new BadRequestException('请先登录账户后再生成图片');
    }

    if (user.role === 'admin' || user.quotaUnlimited) {
      return { mode: 'free' as const, orderId: null };
    }

    if (input.paymentMode === 'credits') {
      const ok = await this.storage.hasEnoughCredits(user.id, costCredits);
      if (!ok) throw new BadRequestException('积分不足，请充值后再生成');
      return { mode: 'credits' as const, orderId: null };
    }

    if (!input.paymentMode && costCredits > 0) {
      const ok = await this.storage.hasEnoughCredits(user.id, costCredits);
      if (ok) return { mode: 'credits' as const, orderId: null };
    }

    const usedToday = await this.storage.countDailyJobs(user.id, new Date().toISOString().slice(0, 10));
    if (usedToday < 1 && !input.paymentMode) {
      return { mode: 'free' as const, orderId: null };
    }

    if (input.paymentMode === 'single') {
      if (!input.paymentOrderId) {
        const order = await this.payments.createSingleJobOrder(user);
        return { mode: 'single_pending', order };
      }

      const order = await this.storage.getPaymentOrder(input.paymentOrderId, user.id);
      if (!order || order.orderType !== 'single_job') {
        throw new BadRequestException('Single payment order is invalid');
      }
      if (order.status !== 'paid') {
        throw new BadRequestException('Single payment order is not paid');
      }
      if (await this.storage.isPaymentOrderUsed(order.id)) {
        throw new BadRequestException('Single payment order has already been used');
      }
      return { mode: 'single' as const, orderId: order.id };
    }

    throw new BadRequestException('积分和今日免费次数都不足，请先充值积分后再生成');
  }

  private extensionForMimeType(mimeType: string) {
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    return '';
  }

  private extensionFromUrl(url: string) {
    const filename = this.objectStorage.filenameFromUrl(url);
    const match = filename.match(/\.[A-Za-z0-9]+$/);
    return match?.[0] ?? '';
  }
}
