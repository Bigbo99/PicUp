import type { ImageQuality, UploadedFileRecord } from '@picup/shared';

export interface ProviderImageInput {
  jobId: string;
  mode: 'generate' | 'edit';
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
