import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AdminOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!unsafeMethods.has(request.method.toUpperCase())) return true;
    if (process.env.ADMIN_ORIGIN_CHECK_ENABLED === 'false') return true;
    if (process.env.APP_ENV !== 'production' && !process.env.ADMIN_ORIGIN_CHECK_ENABLED) return true;

    const origin = request.headers.origin;
    const referer = request.headers.referer;
    const source = origin || referer;
    if (!source) {
      throw new ForbiddenException('Admin origin required');
    }

    const sourceOrigin = this.toOrigin(source);
    const allowed = this.allowedOrigins();
    if (!sourceOrigin || !allowed.has(sourceOrigin)) {
      throw new ForbiddenException('Admin origin rejected');
    }
    return true;
  }

  private allowedOrigins() {
    return new Set([
      process.env.WEB_PUBLIC_URL,
      process.env.API_PUBLIC_URL,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001'
    ].filter(Boolean).map((value) => this.toOrigin(value as string)).filter(Boolean) as string[]);
  }

  private toOrigin(value: string) {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }
}
