import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import type { ImageJobMode, ImageProviderName, ImageQuality, ImageTemplate } from '@picup/shared';

export class CreateImageJobDto {
  @IsIn(['generate', 'edit'])
  mode!: ImageJobMode;

  @IsString()
  provider!: ImageProviderName;

  @IsString()
  model!: string;

  @IsIn([
    'auto',
    'replace_text',
    'remove_object',
    'add_object',
    'replace_background',
    'product',
    'style',
    'poster_text',
    'enhance',
    'freeform'
  ])
  template!: ImageTemplate;

  @IsString()
  prompt!: string;

  @IsArray()
  imageIds!: string[];

  @IsString()
  aspectRatio!: string;

  @IsIn(['512', '1K', '2K', '4K'])
  quality!: ImageQuality;

  @IsOptional()
  @IsIn(['credits', 'single'])
  paymentMode?: 'credits' | 'single';

  @IsOptional()
  @IsString()
  paymentOrderId?: string;
}
