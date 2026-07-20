import { Inject, Injectable } from '@nestjs/common';
import type { ImageJobCreateRequest } from '@picup/shared';
import { AiConfigService } from '../../common/ai-config/ai-config.service';

@Injectable()
export class ModelsService {
  constructor(@Inject(AiConfigService) private readonly aiConfig: AiConfigService) {}

  getModels() {
    return this.aiConfig.getModelsResponse();
  }

  resolveSelection(input: ImageJobCreateRequest) {
    return this.aiConfig.resolveSelection(input);
  }

  getAdminConfig() {
    return this.aiConfig.adminConfig();
  }
}
