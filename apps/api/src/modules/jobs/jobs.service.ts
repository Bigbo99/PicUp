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
import { customImageSize, detectImageIntent, supportsCustomImageSize } from '@picup/shared';
import { StorageService } from '../../common/storage.service';
import { RedisQueueService } from '../../common/queue/redis-queue.service';
import { ModelsService } from '../models/models.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { buildFinalPrompt } from './prompt-builder';
import { compilePromptParts, subjectReferences } from './prompt-parts';
import { compositeRemoval, hasTransparency, validateEditMask } from './edit-mask';
import { preparePreview } from './preview-edit';
import { PrismaService } from '../../common/database/prisma.service';
import { ObjectStorageService } from '../../common/object-storage.service';
import { PaymentsService } from '../payments/payments.service';
import { AiConfigService } from '../../common/ai-config/ai-config.service';
import type { ProviderSlotLease } from '../../common/queue/redis-queue.service';
import type { ProviderImageResult } from '../providers/provider.types';

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
    input = preparePreview(this.validateCount(input));
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
    if (!input.previewOperation && inputFiles.some(file => file.purpose === 'system')) throw new BadRequestException('参考图片不可用');
    if (input.guideFileId) {
      const guide = (await this.storage.getFiles([input.guideFileId], user.id))[0];
      if (!guide || guide.userId !== user.id || guide.purpose !== 'system' || !guide.mimeType.startsWith('image/')) throw new BadRequestException('标记指引不可用');
      inputFiles.push(guide);
    }
    const maskFile = input.maskFileId ? (await this.storage.getFiles([input.maskFileId], user.id))[0] : undefined;
    if (input.maskFileId && (!maskFile || maskFile.userId !== user.id || maskFile.mimeType !== 'image/png')) {
      throw new BadRequestException('蒙版不存在或格式不正确');
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
        ? detectImageIntent(input.prompt, input.imageIds.length > 0)
        : input.template
    };
    const selection = await this.selectProvider(resolvedInput);
    if (maskFile) {
      const [source, mask] = await Promise.all([this.objectStorage.readByUrl(inputFiles[0].url), this.objectStorage.readByUrl(maskFile.url)]);
      await validateEditMask(source, mask);
      if (resolvedInput.previewOperation === 'remove' && await hasTransparency(source)) resolvedInput.background = 'transparent';
    }
    const payment = await this.reservePayment(user, resolvedInput, selection.costCredits);
    if (input.previewOperation) {
      const credits = payment.mode === 'credits' ? selection.costCredits : 0;
      if (input.confirmedCredits !== credits || input.quotedSelection !== `${selection.provider}:${selection.model}`) throw new BadRequestException('本次编辑的模型或积分费用已变化，请重新确认后生成');
    }
    if (payment.mode === 'single_pending') {
      return {
        paymentRequired: true,
        paymentOrder: payment.order
      };
    }
    const finalPrompt = buildFinalPrompt({ input: resolvedInput, prompt: compiled.prompt, subjectNotes });
    const now = new Date().toISOString();
    const job: ImageJobRecord = {
      ...resolvedInput,
      id: randomUUID(),
      userId: user.id,
      status: 'queued',
      selectedProvider: selection.provider,
      selectedModel: selection.model,
      providerRoute: [{ provider: selection.provider, model: selection.model, reason: 'selected', at: now }],
      finalPrompt,
      inputFiles,
      maskFile,
      systemFileIds: input.previewOperation ? [...inputFiles.map(file => file.id), ...(maskFile ? [maskFile.id] : [])] : undefined,
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

  async outputHashes(id: string, user: AuthUser) {
    const job = await this.get(id, user);
    return Promise.all(job.outputImages.map(async image => {
      const body = await this.objectStorage.readByUrl(image.url);
      return createHash('sha256').update(body).digest('hex');
    }));
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
    input = preparePreview(this.validateCount(input));
    const resolved = { ...input, template: input.template === 'auto'
      ? detectImageIntent(input.prompt, input.imageIds.length > 0) : input.template };
    const selection = await this.selectProvider(resolved);
    try {
      const payment = await this.reservePayment(user, { ...resolved,
        paymentMode: (input.count ?? 1) > 1 ? input.paymentMode : input.paymentMode === 'credits' ? 'credits' : undefined
      }, selection.costCredits);
      return { paymentMode: payment.mode === 'credits' ? 'credits' : 'free',
        credits: payment.mode === 'credits' ? selection.costCredits : 0, available: true, selection: `${selection.provider}:${selection.model}` };
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

  async processNext(onStarted?: () => void) {
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

    onStarted?.();
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

    const leases = new Set<ProviderSlotLease>();
    let leaseLost = false;
    let renewing = false;
    let renewalPromise: Promise<void> | null = null;
    const heartbeat = setInterval(async () => {
      if (renewing) return;
      renewing = true;
      renewalPromise = (async () => {
        try {
          if (!await this.storage.renewJobLease(id, owner, this.jobLeaseMs())) leaseLost = true;
          for (const renewingLease of [...leases]) {
            if (!await this.queue.renewProviderSlot(renewingLease) && leases.has(renewingLease)) leaseLost = true;
          }
        } catch (error) {
          leaseLost = true;
          console.error(`[job] ${id} lease renewal failed`, error);
        } finally { renewing = false; }
      })();
      await renewalPromise;
    }, 10_000);
    heartbeat.unref();
    const result: ProviderImageResult = { images: [...running.outputImages], textOutputs: [...running.textOutputs] };
    // Serialize snapshots so a slower database write cannot overwrite a newer output.
    let updates: Promise<void> = Promise.resolve();
    const update = (action: () => Promise<void>) => {
      const pending = updates.then(action);
      updates = pending.catch(() => { leaseLost = true; });
      return pending;
    };
    const saveProgress = async () => {
      if ((running.count ?? 1) <= 1) return;
      running.outputImages = [...result.images];
      running.textOutputs = [...result.textOutputs];
      if (!await this.storage.updateJobProgress(running, owner)) {
        throw new Error('任务执行权已失效，无法保存图片进度');
      }
    };
    const deleteOutputs = async (images: ProviderImageResult['images'], kept: ProviderImageResult['images'] = []) => {
      const keptUrls = new Set(kept.map(image => image.url));
      await Promise.allSettled(images.filter(image => !keptUrls.has(image.url)).map(image => this.objectStorage.deleteByUrl(image.url)));
    };
    const requireLease = async () => {
      if (renewalPromise) await renewalPromise;
      try {
        if (leaseLost || !await this.storage.renewJobLease(id, owner, this.jobLeaseMs())) {
          leaseLost = true;
          throw new Error('任务执行权已失效，停止生成');
        }
      } catch (error) {
        leaseLost = true;
        throw error;
      }
    };
    try {
      const count = this.validateCount(running).count!;
      const initialProvider = running.selectedProvider;
      const failures: unknown[] = [];
      running.outputProgress = Array.from({ length: count }, (_, index) => {
        const prior = running.outputProgress?.[index];
        if (prior?.status === 'succeeded' && prior.outputIndex !== undefined && result.images[prior.outputIndex]) return prior;
        if (!running.outputProgress?.length && result.images[index]) return { status: 'succeeded', outputIndex: index };
        return { status: 'queued' };
      });
      await update(saveProgress);
      const tasks = await Promise.allSettled(Array.from({ length: count }, async (_, imageIndex) => {
        if (running.outputProgress![imageIndex].status === 'succeeded') return;
        let lease: ProviderSlotLease | undefined;
        const release = async () => {
          const previous = lease;
          lease = undefined;
          if (previous) {
            leases.delete(previous);
            await this.queue.releaseProviderSlot(previous);
          }
        };
        let pendingImages: ProviderImageResult['images'] = [];
        try {
          await requireLease();
          // Each output is a separate upstream request, including its RPM budget.
          const providerConfig = this.aiConfig.getProvider(initialProvider);
          lease = await this.queue.acquireProviderSlot(providerConfig.id, providerConfig.concurrency, providerConfig.rpm, providerConfig.timeoutMs);
          if (lease) leases.add(lease);
          await requireLease();
          await update(async () => {
            running.outputProgress![imageIndex] = { status: 'running' };
            await saveProgress();
          });
          const provider = this.providers.get(initialProvider);
          const single = await provider.generate({
            jobId: running.id,
            outputKey: `${running.id}-${running.attempt ?? 0}-${imageIndex}`,
            provider: initialProvider,
            mode: running.mode,
            template: running.template,
            automaticModelSelection: running.provider === 'auto' || running.model === 'auto',
            prompt: running.finalPrompt,
            model: running.selectedModel,
            aspectRatio: running.aspectRatio,
            quality: running.quality,
            width: running.width,
            height: running.height,
            images: running.inputFiles,
            mask: running.maskFile,
            background: running.background
          }, {
            switchProvider: async (providerId) => {
              const next = this.aiConfig.getProvider(providerId, true);
              await requireLease();
              // Release before waiting because providers can name each other as fallbacks.
              await release();
              lease = await this.queue.acquireProviderSlot(next.id, next.concurrency, next.rpm, next.timeoutMs);
              if (lease) leases.add(lease);
              await requireLease();
              await update(async () => {
                running.selectedProvider = next.id;
                running.providerRoute = [...(running.providerRoute ?? []), {
                  provider: next.id, model: running.selectedModel, reason: 'fallback', at: new Date().toISOString()
                }];
                if (await this.storage.updateJobExecutionRoute?.(running, owner) === false) {
                  throw new Error('任务执行权已失效，无法记录备用渠道');
                }
              });
              console.warn(`[job] ${id} provider fallback=${next.id} output=${imageIndex + 1}`);
            }
          });
          pendingImages = single.images;
          single.images = single.images.slice(0, 1);
          await deleteOutputs(pendingImages, single.images);
          pendingImages = single.images;
          if (!single.images.length) throw new Error('模型未返回图片，请稍后重试');
          if (running.previewOperation === 'remove' && running.maskFile) {
            const rawOutputs = [...single.images];
            const protectedOutputs: typeof single.images = [];
            try {
              const [source, mask] = await Promise.all([
                this.objectStorage.readByUrl(running.inputFiles[0].url),
                this.objectStorage.readByUrl(running.maskFile.url)
              ]);
              for (const [index, output] of rawOutputs.entries()) {
                const image = await compositeRemoval(source, mask, await this.objectStorage.readByUrl(output.url));
                const url = await this.objectStorage.save('outputs', `${running.id}-${running.attempt ?? 0}-${imageIndex}-protected-${index}.png`, image.body, 'image/png');
                protectedOutputs.push({ url, mimeType: 'image/png', width: image.width, height: image.height });
              }
              single.images = protectedOutputs;
              pendingImages = protectedOutputs;
            } catch (error) {
              await deleteOutputs(protectedOutputs);
              throw error;
            } finally {
              await deleteOutputs(rawOutputs);
            }
          }
          await requireLease();
          // A progress write may commit even if its response is lost; reconcile in the outer catch.
          pendingImages = [];
          await update(async () => {
            running.outputProgress![imageIndex] = { status: 'succeeded', outputIndex: result.images.length };
            result.images.push(...single.images);
            result.textOutputs.push(...single.textOutputs);
            await saveProgress();
          });
        } catch (error) {
          await deleteOutputs(pendingImages);
          if (leaseLost) throw error;
          failures.push(error);
          await update(async () => {
            running.outputProgress![imageIndex] = { status: 'failed' };
            await saveProgress();
          });
          console.error(`[job] ${id} output ${imageIndex + 1}/${count} failed`, error);
        } finally {
          if (renewalPromise) await renewalPromise;
          await release().catch(error => {
            console.error(`[job] ${id} provider slot release failed`, error);
          });
        }
      }));
      const rejected = tasks.find(task => task.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      if (!result.images.length) throw failures[0] ?? new Error('模型未返回图片，请稍后重试');
      await requireLease();
      const completed: ImageJobRecord = {
        ...running,
        status: 'succeeded',
        leaseOwner: null,
        leaseExpiresAt: null,
        outputImages: result.images,
        textOutputs: result.textOutputs,
        error: failures.length ? {
          code: 'BATCH_PARTIAL_FAILURE',
          message: `已生成 ${result.images.length}/${count} 张图片，其余图片生成失败。`
        } : null,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      const saved = await this.storage.completeJob(completed, owner);
      if (saved && ['succeeded', 'failed', 'refunded'].includes(saved.status)) await this.ackTerminalJob(completed.id);
      if (!saved) {
        const latest = await this.storage.getJob(id);
        await deleteOutputs(result.images, latest?.outputImages);
        return latest;
      }
      await deleteOutputs(result.images, saved.outputImages);
      console.log(`[job] ${completed.id} succeeded outputs=${completed.outputImages.length}`);
      return saved;
    } catch (error) {
      const latest = await this.storage.getJob(running.id);
      if (latest?.status === 'succeeded') {
        await deleteOutputs(result.images, latest.outputImages);
        await this.ackTerminalJob(latest.id);
        return latest;
      }
      await deleteOutputs(result.images, latest?.outputImages);
      if (leaseLost || (latest?.status === 'running' && latest.outputImages.length > 0)) {
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
      for (const lease of leases) {
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

  private validateCount(input: ImageJobCreateRequest): ImageJobCreateRequest {
    if (input.width !== undefined || input.height !== undefined) {
      if (input.previewOperation) throw new BadRequestException('预览编辑请使用比例设置');
      try { input = { ...input, ...customImageSize(input.width!, input.height!) }; }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '图片尺寸无效'); }
    }
    const count = input.count === undefined ? 1 : input.count;
    if (!Number.isInteger(count) || count < 1 || count > 4) {
      throw new BadRequestException('生成数量必须为 1 至 4 张');
    }
    if (input.previewOperation && count !== 1) {
      throw new BadRequestException('预览编辑每次只能生成 1 张');
    }
    return { ...input, count };
  }

  private async selectProvider(input: ImageJobCreateRequest) {
    const selection = this.models.resolveSelection(input);
    if (input.maskFileId || input.background) {
      const upstream = selection.model.upstreamModel ?? selection.model.model;
      if (input.mode !== 'edit' || !input.imageIds.length || selection.provider.type !== 'openai-images' || !/^gpt-image-/i.test(upstream)) {
        throw new BadRequestException('局部蒙版和透明背景需要选择支持 GPT Image 的图片编辑模型');
      }
    }
    if (input.imageIds.length + (input.guideFileId ? 1 : 0) > selection.model.maxInputImages) {
      throw new BadRequestException(`当前模型最多支持 ${selection.model.maxInputImages} 张参考图`);
    }
    if (input.width !== undefined && !supportsCustomImageSize(selection.provider.type, selection.model.model)) {
      throw new BadRequestException('当前模型不支持自定义像素尺寸，请选择 GPT Image 2 或 2.5');
    }
    if (input.width === undefined && !selection.model.supportedRatios.includes(input.aspectRatio)) {
      throw new BadRequestException(`当前模型不支持 ${input.aspectRatio} 图片比例`);
    }
    if (!selection.model.supportedQualities.includes(input.quality)) {
      throw new BadRequestException(`当前模型不支持 ${input.quality} 分辨率`);
    }
    return {
      provider: selection.provider.id,
      model: selection.model.model,
      costCredits: (input.previewOperation === 'background' ? 1 : selection.model.costCredits) * (input.count ?? 1)
    };
  }

  private async reservePayment(user: AuthUser, input: ImageJobCreateRequest, costCredits: number): Promise<ReservedPayment> {
    if (user.isGuest) {
      throw new BadRequestException('请先登录账户后再生成图片');
    }

    if (user.role === 'admin' || user.quotaUnlimited) {
      return { mode: 'free' as const, orderId: null };
    }

    if ((input.count ?? 1) > 1) {
      if (input.paymentMode === 'single' || input.paymentOrderId) {
        throw new BadRequestException('多图生成请使用积分支付');
      }
      if (!await this.storage.hasEnoughCredits(user.id, costCredits)) {
        throw new BadRequestException('多图生成积分不足，请充值或改为生成 1 张');
      }
      return { mode: 'credits', orderId: null };
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
