import type { ImageQuality, ImageTemplate, UploadedFileRecord } from '@picup/shared';

export interface ProviderImageInput {
  jobId: string;
  outputKey?: string;
  provider: string;
  mode: 'generate' | 'edit';
  template: ImageTemplate;
  automaticModelSelection: boolean;
  prompt: string;
  model: string;
  aspectRatio: string;
  quality: ImageQuality;
  width?: number;
  height?: number;
  images: UploadedFileRecord[];
  mask?: UploadedFileRecord;
  background?: 'transparent';
}

export interface ProviderImageResult {
  images: Array<{
    url: string;
    mimeType: string;
    width?: number;
    height?: number;
  }>;
  textOutputs: string[];
}

export interface ImageProvider {
  generate(input: ProviderImageInput, execution?: ProviderExecutionContext): Promise<ProviderImageResult>;
}

export interface ProviderExecutionContext {
  /** Release the old provider's slot and acquire the next provider's budget. */
  switchProvider(providerId: string): Promise<void>;
}
