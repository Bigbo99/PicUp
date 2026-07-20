import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ImageJobCreateRequest,
  ImageJobCreateResponse,
  ImageJobRecord,
  PaymentOrderResponse,
  AuthUser
} from '@picup/shared';
import { detectImageIntent } from '@picup/shared';
import { StorageService } from '../../common/storage.service';
import { RedisQueueService } from '../../common/queue/redis-queue.service';
import { ModelsService } from '../models/models.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { buildFinalPrompt } from './prompt-builder';
import { ObjectStorageService } from '../../common/object-storage.service';
import { PaymentsService } from '../payments/payments.service';

type ReservedPayment =
  | { mode: 'free' | 'credits' | 'single'; orderId: string | null }
  | { mode: 'single_pending'; order: PaymentOrderResponse };

@Injectable()
export class JobsService {
  constructor(
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
    private readonly payments: PaymentsService
  ) {}

  async create(input: ImageJobCreateRequest, user: AuthUser): Promise<ImageJobCreateResponse> {
    if (!input.prompt?.trim()) throw new BadRequestException('请输入 P 图需求');
    if (input.mode === 'edit' && input.imageIds.length === 0) {
      throw new BadRequestException('图片编辑需要先上传图片');
    }

    const inputFiles = await this.storage.getFiles(input.imageIds, user.id);
    if (inputFiles.length !== input.imageIds.length) {
      throw new BadRequestException('上传图片不存在或已过期');
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
    const finalPrompt = buildFinalPrompt(resolvedInput.template, resolvedInput.prompt);
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
      createdAt: now,
      updatedAt: now
    };

    await this.storage.upsertJob(job);
    await this.queue.enqueueJob(job.id);
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

  async list(limit = 20, user?: AuthUser) {
    return this.storage.listJobs(limit, user?.id, false);
  }

  async delete(id: string, user: AuthUser) {
    const deleted = await this.storage.deleteJob(id, user.id, false);
    if (!deleted) throw new NotFoundException('任务不存在');
    await this.cleanupOutputFiles(deleted);
    return { ok: true, jobId: id };
  }

  async processNext() {
    const jobId = await this.queue.dequeueJob();
    if (!jobId) return null;

    try {
      return await this.process(jobId);
    } finally {
      await this.queue.ackJob(jobId);
    }
  }

  async process(id: string) {
    const job = await this.storage.getJob(id);
    if (!job) throw new NotFoundException('任务不存在');
    if (job.status !== 'queued' && job.status !== 'retrying') return job;

    const running: ImageJobRecord = {
      ...job,
      status: 'running',
      updatedAt: new Date().toISOString()
    };
    await this.storage.upsertJob(running);
    console.log(`[job] ${running.id} running provider=${running.selectedProvider} model=${running.selectedModel}`);

    try {
      const provider = this.providers.get(running.selectedProvider);
      const result = await provider.generate({
        jobId: running.id,
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
      const completed: ImageJobRecord = {
        ...running,
        status: 'succeeded',
        outputImages: result.images,
        textOutputs: result.textOutputs,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      await this.storage.upsertJob(completed);
      console.log(`[job] ${completed.id} succeeded outputs=${completed.outputImages.length}`);
      return completed;
    } catch (error) {
      const failed: ImageJobRecord = {
        ...running,
        status: 'failed',
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: error instanceof Error ? error.message : '模型服务暂时不可用'
        },
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      await this.storage.upsertJob(failed);
      await this.refundFailedJob(failed);
      console.error(`[job] ${failed.id} failed ${failed.error?.code}: ${failed.error?.message}`);
      return failed;
    }
  }

  async restoreQueuedJobs() {
    await this.queue.restoreProcessingJobs();
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
      const ok = await this.storage.debitCredits(user.id, costCredits);
      if (!ok) throw new BadRequestException('积分不足，请充值后再生成');
      return { mode: 'credits' as const, orderId: null };
    }

    if (!input.paymentMode && costCredits > 0) {
      const ok = await this.storage.debitCredits(user.id, costCredits);
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

  private async refundFailedJob(job: ImageJobRecord) {
    if (job.paymentMode !== 'credits' || !job.userId || job.creditsReserved <= 0) return;
    await this.storage.creditUser(job.userId, job.creditsReserved);
    await this.storage.upsertJob({
      ...job,
      status: 'refunded',
      updatedAt: new Date().toISOString()
    });
  }

  private async cleanupOutputFiles(job: ImageJobRecord) {
    await Promise.allSettled(job.outputImages.map(async (image) => {
      await this.objectStorage.deleteByUrl(image.url);
    }));
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
