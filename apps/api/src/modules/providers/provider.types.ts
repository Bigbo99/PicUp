import type { ImageQuality, ImageTemplate, UploadedFileRecord } from '@picup/shared';

export interface ProviderImageInput {
  jobId: string;
  provider: string;
  mode: 'generate' | 'edit';
  template: ImageTemplate;
  automaticModelSelection: boolean;
  prompt: string;
  model: string;
  aspectRatio: string;
  quality: ImageQuality;
  images: UploadedFileRecord[];
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
  generate(input: ProviderImageInput): Promise<ProviderImageResult>;
}
