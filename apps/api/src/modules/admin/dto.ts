import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import type { AiProviderType, AiRequestPaths, AiRoutingTarget, ImageQuality } from '@picup/shared';

export class UpdateModelConfigDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxInputImages?: number;

  @IsOptional()
  @IsArray()
  supportedRatios?: string[];

  @IsOptional()
  @IsArray()
  supportedQualities?: ImageQuality[];

  @IsOptional()
  @IsInt()
  @Min(0)
  costCredits?: number;
}

export class UpsertSettingDto {
  @IsObject()
  value!: Record<string, unknown>;
}

export class CreateAiProviderDto {
  @IsString()
  id!: string;

  @IsIn(['grsai', 'gemini-official', 'openai-images', 'openai-compatible'])
  type!: AiProviderType;

  @IsString()
  displayName!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsString()
  baseUrl!: string;

  @IsObject()
  paths!: AiRequestPaths;

  @IsString()
  defaultModel!: string;

  @IsOptional()
  @IsArray()
  aliases?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fallbackProviderIds?: string[];

  @IsOptional()
  @IsBoolean()
  fallbackOnly?: boolean;

  @IsOptional()
  @IsIn(['high'])
  imageQuality?: 'high';

  @IsOptional()
  @IsIn(['url'])
  imageResponseFormat?: 'url';

  @IsOptional()
  @IsInt()
  @Min(1000)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  concurrency?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  rpm?: number;
}

export class UpdateAiProviderDto {
  @IsOptional()
  @IsIn(['grsai', 'gemini-official', 'openai-images', 'openai-compatible'])
  type?: AiProviderType;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsObject()
  paths?: AiRequestPaths;

  @IsOptional()
  @IsString()
  defaultModel?: string;

  @IsOptional()
  @IsArray()
  aliases?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fallbackProviderIds?: string[];

  @IsOptional()
  @IsBoolean()
  fallbackOnly?: boolean;

  @IsOptional()
  @IsIn(['high'])
  imageQuality?: 'high';

  @IsOptional()
  @IsIn(['url'])
  imageResponseFormat?: 'url';

  @IsOptional()
  @IsInt()
  @Min(1000)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  concurrency?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  rpm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  retryAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  retryDelayMs?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  pollIntervalMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  downloadRetryAttempts?: number;

  @IsOptional()
  @IsString()
  proxyUrl?: string;

  @IsOptional()
  @IsString()
  downloadProxyUrl?: string;

  @IsOptional()
  @IsBoolean()
  disableProxy?: boolean;
}

export class CreateAiModelDto {
  @IsString()
  model!: string;

  @IsOptional()
  @IsString()
  upstreamModel?: string;

  @IsOptional()
  @IsArray()
  aliases?: string[];

  @IsString()
  displayName!: string;

  @IsString()
  description!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(1)
  priority!: number;

  @IsInt()
  @Min(0)
  maxInputImages!: number;

  @IsArray()
  supportedRatios!: string[];

  @IsArray()
  supportedQualities!: ImageQuality[];

  @IsInt()
  @Min(0)
  costCredits!: number;

  @IsOptional()
  @IsObject()
  qualityModelOverrides?: Partial<Record<ImageQuality, string>>;

  @IsOptional()
  @IsArray()
  fallbackModels?: string[];
}

export class UpdateAiModelDto extends UpdateModelConfigDto {
  @IsOptional()
  @IsString()
  upstreamModel?: string;

  @IsOptional()
  @IsArray()
  aliases?: string[];

  @IsOptional()
  @IsObject()
  qualityModelOverrides?: Partial<Record<ImageQuality, string>>;

  @IsOptional()
  @IsArray()
  fallbackModels?: string[];
}

export class UpdateAiRoutingDto {
  @IsObject()
  default!: AiRoutingTarget;

  @IsObject()
  professional!: AiRoutingTarget;
}

export class UpdateAiMockDto {
  @IsBoolean()
  mockEnabled!: boolean;
}

export class UpdateUserQuotaDto {
  @IsBoolean()
  quotaUnlimited!: boolean;
}

export class UpdateUserStatusDto {
  @IsIn(['pending', 'active', 'disabled'])
  status!: 'pending' | 'active' | 'disabled';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateUserCreditsDto {
  @IsInt()
  @Min(-1000)
  @Max(1000)
  delta!: number;

  @IsString()
  reason!: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  displayName?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';

  @IsOptional()
  @IsIn(['pending', 'active', 'disabled'])
  status?: 'pending' | 'active' | 'disabled';

  @IsOptional()
  @IsBoolean()
  quotaUnlimited?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999999999)
  creditBalance?: number;
}
