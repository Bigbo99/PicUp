import { Injectable } from '@nestjs/common';
import type { ImageProvider, ProviderImageInput, ProviderImageResult } from './provider.types';

@Injectable()
export class GrsAiProvider implements ImageProvider {
  async generate(_input: ProviderImageInput): Promise<ProviderImageResult> {
    if (!process.env.GRSAI_API_KEY) {
      throw new Error('GRSAI_API_KEY 未配置');
    }
    throw new Error('GrsAI Provider 已预留，待补充实际接口字段后启用');
  }
}
