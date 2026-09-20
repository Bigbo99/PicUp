import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, MaxLength, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { PromptPart } from '@picup/shared';
import type { ImageJobMode, ImageProviderName, ImageQuality, ImageTemplate } from '@picup/shared';

class EditCommentDto {
  @IsNumber() @Min(0) @Max(100) x!: number;
  @IsNumber() @Min(0) @Max(100) y!: number;
  @IsString() @MaxLength(200) text!: string;
}

export class CreateImageJobDto {
  @IsOptional() @IsIn(['describe', 'annotate', 'comment', 'background', 'remove', 'resize'])
  previewOperation?: 'describe' | 'annotate' | 'comment' | 'background' | 'remove' | 'resize';
  @IsOptional() @IsUUID() guideFileId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => EditCommentDto)
  editComments?: EditCommentDto[];
  @IsOptional() @IsInt() @Min(0) confirmedCredits?: number;
  @IsOptional() @IsString() @MaxLength(300) quotedSelection?: string;
  @IsOptional()
  @IsUUID()
  maskFileId?: string;

  @IsOptional()
  @IsIn(['transparent'])
  background?: 'transparent';

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
