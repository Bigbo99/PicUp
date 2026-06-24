import { Inject, Injectable } from '@nestjs/common';
import {
  MODEL_CONFIG_DEFAULTS,
  findModelCatalogEntry,
  resolveModelCatalogModel,
  type ModelConfig,
  type ModelsResponse
} from '@picup/shared';
import { StorageService } from '../../common/storage.service';

@Injectable()
export class ModelsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  async getModels(): Promise<ModelsResponse> {
    const models = await this.storage.getModelConfigs(this.defaultModels());
    const normalized = new Map<string, ModelConfig>();

    for (const model of models) {
      const catalog = findModelCatalogEntry(model.provider, model.model);
      if (!catalog) continue;
      normalized.set(`${catalog.provider}:${catalog.model}`, {
        ...model,
        provider: catalog.provider,
        model: catalog.model,
        displayName: catalog.displayName,
        description: catalog.description,
        maxInputImages: catalog.maxInputImages,
        supportedRatios: [...catalog.supportedRatios],
        supportedQualities: [...catalog.supportedQualities],
        costCredits: catalog.costCredits
      });
    }

    return {
      models: [...normalized.values()],
      defaultProvider: 'auto',
      defaultModel: 'gemini-3.1-flash-image'
    };
  }

  defaultModels(): ModelConfig[] {
    return MODEL_CONFIG_DEFAULTS.map((model) => ({
      ...model,
      supportedRatios: [...model.supportedRatios],
      supportedQualities: [...model.supportedQualities]
    }));
  }

  canonicalModel(provider: string, model: string) {
    return resolveModelCatalogModel(provider, model);
  }
}
