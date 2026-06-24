import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import type { ImageQuality } from '@picup/shared';

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
