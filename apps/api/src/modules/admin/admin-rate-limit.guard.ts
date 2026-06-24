import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class AdminRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { authUser?: { id?: string } }>();
    const now = Date.now();
    const method = request.method.toUpperCase();
    const isWrite = unsafeMethods.has(method);
    const limit = this.limitFor(isWrite);
    const identity = request.authUser?.id || this.ipFor(request) || 'anonymous';
    const key = `admin:${isWrite ? 'write' : 'read'}:${identity}`;
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      this.cleanup(now);
      return true;
    }

    if (bucket.count >= limit) {
      throw new HttpException('Admin rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    bucket.count += 1;
    return true;
  }

  private limitFor(isWrite: boolean) {
    const envName = isWrite ? 'ADMIN_WRITE_RATE_LIMIT_PER_MINUTE' : 'ADMIN_READ_RATE_LIMIT_PER_MINUTE';
    const fallback = isWrite ? 20 : 120;
    const value = Number(process.env[envName]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private ipFor(request: Request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (Array.isArray(forwardedFor)) return forwardedFor[0];
    return forwardedFor?.split(',')[0]?.trim() || request.socket.remoteAddress;
  }

  private cleanup(now: number) {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
