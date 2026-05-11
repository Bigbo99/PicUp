import { Inject, Injectable } from '@nestjs/common';
import type { ModelConfig, ModelsResponse } from '@picup/shared';
import { StorageService } from '../../common/storage.service';

const GEMINI_STANDARD_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'];
const GEMINI_31_FLASH_RATIOS = ['1:1', '1:8', '1:4', '2:3', '3:2', '3:4', '8:1', '4:1', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'];

@Injectable()
export class ModelsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  async getModels(): Promise<ModelsResponse> {
    const models = await this.storage.getModelConfigs(this.defaultModels());
    return {
      models,
      defaultProvider: 'auto',
      defaultModel: 'gemini-3.1-flash-image-preview'
    };
  }

  defaultModels(): ModelConfig[] {
    return [
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash-image',
        displayName: 'Gemini 2.5 Flash Image',
        description: '固定 1024px 输出，最多 3 张参考图，适合快速图片编辑',
        enabled: true,
        priority: 10,
        maxInputImages: 3,
        supportedRatios: GEMINI_STANDARD_RATIOS,
        supportedQualities: ['1K'],
        costCredits: 1
      },
      {
        provider: 'gemini',
        model: 'gemini-3.1-flash-image-preview',
        displayName: 'Gemini 3.1 Flash Image',
        description: '支持 512、1K、2K、4K 与极端横竖比，最多 14 张参考图',
        enabled: true,
        priority: 20,
        maxInputImages: 14,
        supportedRatios: GEMINI_31_FLASH_RATIOS,
        supportedQualities: ['512', '1K', '2K', '4K'],
        costCredits: 1
      },
      {
        provider: 'gemini',
        model: 'gemini-3-pro-image-preview',
        displayName: 'Gemini 3 Pro Image',
        description: '专业图片生成与编辑，支持 1K、2K、4K，最多 14 张参考图',
        enabled: true,
        priority: 30,
        maxInputImages: 14,
        supportedRatios: GEMINI_STANDARD_RATIOS,
        supportedQualities: ['1K', '2K', '4K'],
        costCredits: 2
      },
      {
        provider: 'grsai',
        model: 'gpt-image',
        displayName: 'GrsAI GPT Image',
        description: '备用通道，适合异步任务和低成本生成',
        enabled: true,
        priority: 40,
        maxInputImages: 4,
        supportedRatios: ['1:1', '16:9', '9:16', '3:4', '4:5'],
        supportedQualities: ['1K'],
        costCredits: 1
      }
    ];
  }
}
