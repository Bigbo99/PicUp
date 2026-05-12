import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ImageJobCreateRequest,
  ImageJobCreateResponse,
  ImageJobRecord,
  ImageProviderName,
  AuthUser
} from '@picup/shared';
import { StorageService } from '../../common/storage.service';
import { RedisQueueService } from '../../common/queue/redis-queue.service';
import { ModelsService } from '../models/models.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { buildFinalPrompt } from './prompt-builder';

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
    private readonly providers: ProviderRegistry
  ) {}

  async create(input: ImageJobCreateRequest, user: AuthUser): Promise<ImageJobCreateResponse> {
    if (!input.prompt?.trim()) throw new BadRequestException('请输入 P 图需求');
    if (input.mode === 'edit' && input.imageIds.length === 0) {
      throw new BadRequestException('图片编辑需要先上传图片');
    }

    await this.ensureQuota(user);

    const inputFiles = await this.storage.getFiles(input.imageIds, user.id);
    if (inputFiles.length !== input.imageIds.length) {
      throw new BadRequestException('上传图片不存在或已过期');
    }

    const selection = await this.selectProvider(input);
    const finalPrompt = buildFinalPrompt(input.template, input.prompt);
    const now = new Date().toISOString();
    const job: ImageJobRecord = {
      ...input,
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
      createdAt: now,
      updatedAt: now
    };

    await this.storage.upsertJob(job);
    await this.queue.enqueueJob(job.id);
    return { jobId: job.id, status: job.status, creditsReserved: job.creditsReserved };
  }

  async get(id: string, user?: AuthUser) {
    const job = await this.storage.getJob(id, user?.id, user?.role === 'admin');
    if (!job) throw new NotFoundException('任务不存在');
    return job;
  }

  async list(limit = 20, user?: AuthUser) {
    return this.storage.listJobs(limit, user?.id, user?.role === 'admin');
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
        mode: running.mode,
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
      console.error(`[job] ${failed.id} failed ${failed.error?.code}: ${failed.error?.message}`);
      return failed;
    }
  }

  async restoreQueuedJobs() {
    await this.queue.restoreProcessingJobs();
  }

  private async selectProvider(input: ImageJobCreateRequest) {
    const available = (await this.models.getModels()).models.filter((model) => model.enabled);
    const provider = this.resolveProvider(input);
    const model = input.model === 'auto'
      ? this.defaultModelFor(input, provider)
      : input.model;
    const config = available.find((item) => item.provider === provider && item.model === model)
      ?? available.find((item) => item.provider === provider);

    if (!config) throw new BadRequestException('当前模型不可用');
    if (input.imageIds.length > config.maxInputImages) {
      throw new BadRequestException(`当前模型最多支持 ${config.maxInputImages} 张参考图`);
    }
    if (!config.supportedRatios.includes(input.aspectRatio)) {
      throw new BadRequestException(`当前模型不支持 ${input.aspectRatio} 图片比例`);
    }
    if (!config.supportedQualities.includes(input.quality)) {
      throw new BadRequestException(`当前模型不支持 ${input.quality} 分辨率`);
    }
    return { provider, model: config.model, costCredits: config.costCredits };
  }

  private async ensureQuota(user: AuthUser) {
    if (user.role === 'admin') return;

    const dailyTotal = user.role === 'guest' ? 3 : 10;
    const used = await this.storage.countDailyJobs(user.id, new Date().toISOString().slice(0, 10));
    if (used >= dailyTotal) {
      throw new BadRequestException('Daily free quota has been used up');
    }
  }

  private resolveProvider(input: ImageJobCreateRequest): Exclude<ImageProviderName, 'auto'> {
    if (input.provider !== 'auto') return input.provider;
    if (input.template === 'product' || input.quality === '4K') return 'gemini';
    if (input.template === 'replace_text' || input.template === 'poster_text') return 'gemini';
    return 'gemini';
  }

  private defaultModelFor(input: ImageJobCreateRequest, provider: Exclude<ImageProviderName, 'auto'>) {
    if (provider === 'grsai') return 'gpt-image';
    if (input.quality === '512') return 'gemini-3.1-flash-image-preview';
    if (input.quality === '4K' || input.template === 'product') return 'gemini-3-pro-image-preview';
    return 'gemini-3.1-flash-image-preview';
  }
}
