import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import type { PromptPart } from '@picup/shared';
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
  @MaxLength(4000)
  prompt!: string;

  // Discriminated parts receive strict shape validation in compilePromptParts.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  promptParts?: PromptPart[];

  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @ArrayUnique()
  @IsUUID('all', { each: true })
  imageIds!: string[];

  @IsOptional()
  @IsUUID()
  parentJobId?: string;

  @IsString()
  aspectRatio!: string;

  @IsIn(['512', '1K', '2K', '4K'])
  quality!: ImageQuality;

  @IsOptional()
  @IsString()
  @Length(16, 128)
  idempotencyKey?: string;

  @IsOptional()
  @IsIn(['credits', 'single'])
  paymentMode?: 'credits' | 'single';

  @IsOptional()
  @IsString()
  paymentOrderId?: string;
}
