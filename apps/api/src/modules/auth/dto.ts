import { IsEmail, IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import type { AuthProfileUpdateRequest, EmailAuthMode } from '@picup/shared';

export class AuthCredentialsDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class EmailAuthStartDto {
  @IsEmail()
  email!: string;

  @IsIn(['register', 'login'])
  mode!: EmailAuthMode;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class EmailAuthVerifyDto {
  @IsString()
  challengeId!: string;

  @IsString()
  code!: string;
}

export class WechatAuthCallbackDto {
  @IsString()
  state!: string;

  @IsString()
  openId!: string;

  @IsOptional()
  @IsString()
  unionId?: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsObject()
  profile?: Record<string, unknown>;
}

export class AuthProfileUpdateDto implements AuthProfileUpdateRequest {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
