import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { createHmac, pbkdf2Sync, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  AuthCredentials,
  AuthMeResponse,
  AuthUser,
  EmailAuthStartRequest,
  EmailAuthStartResponse,
  EmailAuthVerifyRequest,
  UserRole,
  WechatAuthStartResponse,
  WechatAuthStatusResponse
} from '@picup/shared';
import { StorageService, type StoredUser } from '../../common/storage.service';
import { PrismaService } from '../../common/database/prisma.service';
import type { AuthenticatedRequest } from './auth.types';
import type { WechatAuthCallbackDto } from './dto';

interface SessionPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

const sessionCookieName = 'picup_session';
const sessionTtlSeconds = 60 * 60 * 24 * 30;
const emailChallengeTtlMs = 10 * 60 * 1000;
const wechatSessionTtlMs = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    private readonly prisma: PrismaService
  ) {}

  async me(req: AuthenticatedRequest, res: Response): Promise<AuthMeResponse> {
    const user = await this.ensureRequestUser(req, res);
    return this.withQuota(user);
  }

  async register(input: AuthCredentials, res: Response): Promise<AuthMeResponse> {
    const email = this.normalizeEmail(input.email);
    const existing = await this.storage.getUserByEmail(email);
    if (existing && !existing.isGuest) {
      throw new ConflictException('Email is already registered');
    }

    const user = this.storage.createStoredUser({
      id: randomUUID(),
      email,
      role: this.roleForEmail(email),
      isGuest: false,
      passwordHash: this.hashPassword(input.password),
      emailVerifiedAt: new Date().toISOString()
    });
    await this.storage.addUser(user);
    this.setSessionCookie(res, user);
    return this.withQuota(this.toPublicUser(user));
  }

  async login(input: AuthCredentials, res: Response): Promise<AuthMeResponse> {
    const email = this.normalizeEmail(input.email);
    const user = await this.storage.getUserByEmail(email);
    if (!user || user.isGuest || !user.passwordHash || !this.verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('User is disabled');
    }

    const nextUser = { ...user, role: this.roleForEmail(email, user.role), updatedAt: new Date().toISOString() };
    await this.storage.updateUser(nextUser);
    this.setSessionCookie(res, nextUser);
    return this.withQuota(this.toPublicUser(nextUser));
  }

  logout(res: Response) {
    res.clearCookie(sessionCookieName, this.cookieOptions());
    return { ok: true };
  }

  async startEmailAuth(input: EmailAuthStartRequest): Promise<EmailAuthStartResponse> {
    const email = this.normalizeEmail(input.email);
    const mode = input.mode;
    const existing = await this.storage.getUserByEmail(email);

    if (mode === 'register') {
      if (!input.password || input.password.length < 8) {
        throw new BadRequestException('Password must be at least 8 characters');
      }
      if (existing && !existing.isGuest && existing.status === 'active') {
        throw new ConflictException('Email is already registered');
      }
    }

    if (mode === 'login' && (!existing || existing.isGuest || existing.status !== 'active')) {
      throw new UnauthorizedException('Invalid email or account is not active');
    }

    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + emailChallengeTtlMs);
    const challenge = await this.prisma.emailAuthChallenge.create({
      data: {
        email,
        mode,
        userId: existing?.id,
        passwordHash: mode === 'register' && input.password ? this.hashPassword(input.password) : null,
        codeHash: this.hashOneTimeCode(code),
        expiresAt
      }
    });

    const delivered = await this.deliverEmailCode(email, code, mode);
    return {
      challengeId: challenge.id,
      email,
      mode,
      expiresAt: expiresAt.toISOString(),
      delivery: delivered ? 'email' : 'dev',
      ...(!delivered && process.env.APP_ENV !== 'production' ? { devCode: code } : {})
    };
  }

  async verifyEmailAuth(input: EmailAuthVerifyRequest, res: Response): Promise<AuthMeResponse> {
    const challenge = await this.prisma.emailAuthChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      throw new BadRequestException('Verification code is invalid or expired');
    }
    if (challenge.attempts >= 5) {
      throw new BadRequestException('Too many verification attempts');
    }
    if (!this.safeEqual(this.hashOneTimeCode(input.code.trim()), challenge.codeHash)) {
      await this.prisma.emailAuthChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } }
      });
      throw new BadRequestException('Verification code is invalid or expired');
    }

    const email = this.normalizeEmail(challenge.email);
    const existing = await this.storage.getUserByEmail(email);
    let user: StoredUser;
    if (challenge.mode === 'register') {
      if (existing && !existing.isGuest && existing.status === 'active') {
        throw new ConflictException('Email is already registered');
      }
      user = existing && !existing.isGuest
        ? await this.storage.updateUser({
          ...existing,
          role: this.roleForEmail(email, existing.role),
          status: 'active',
          isGuest: false,
          passwordHash: challenge.passwordHash ?? existing.passwordHash,
          emailVerifiedAt: new Date().toISOString()
        })
        : await this.storage.addUser(this.storage.createStoredUser({
          id: randomUUID(),
          email,
          role: this.roleForEmail(email),
          status: 'active',
          isGuest: false,
          passwordHash: challenge.passwordHash,
          emailVerifiedAt: new Date().toISOString()
        }));
    } else {
      if (!existing || existing.isGuest || existing.status !== 'active') {
        throw new UnauthorizedException('Invalid email or account is not active');
      }
      user = existing;
    }

    await this.prisma.emailAuthChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date(), userId: user.id }
    });
    this.setSessionCookie(res, user);
    return this.withQuota(this.toPublicUser(user));
  }

  async startWechatAuth(): Promise<WechatAuthStartResponse> {
    const state = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + wechatSessionTtlMs);
    const apiPublicUrl = process.env.API_PUBLIC_URL?.trim() || 'http://localhost:4000';
    const callbackUrl = `${apiPublicUrl.replace(/\/$/, '')}/api/auth/wechat/callback`;
    const qrCodeUrl = this.buildWechatQrUrl(state, callbackUrl);
    const session = await this.prisma.wechatLoginSession.create({
      data: { state, qrCodeUrl, expiresAt }
    });
    return {
      state,
      qrCodeUrl: session.qrCodeUrl,
      expiresAt: expiresAt.toISOString()
    };
  }

  async getWechatStatus(state: string, res: Response): Promise<WechatAuthStatusResponse> {
    const session = await this.prisma.wechatLoginSession.findUnique({ where: { state } });
    if (!session) throw new BadRequestException('Wechat login session not found');
    if (session.consumedAt) return { status: 'consumed' };
    if (session.expiresAt <= new Date() && session.status === 'pending') {
      await this.prisma.wechatLoginSession.update({ where: { state }, data: { status: 'expired' } });
      return { status: 'expired' };
    }
    if (session.status !== 'confirmed' || !session.userId) return { status: 'pending' };

    const stored = await this.storage.getUserById(session.userId);
    if (!stored || stored.status !== 'active') throw new UnauthorizedException('User is not active');
    await this.prisma.wechatLoginSession.update({ where: { state }, data: { status: 'consumed', consumedAt: new Date() } });
    this.setSessionCookie(res, stored);
    const me = await this.withQuota(this.toPublicUser(stored));
    return { status: 'confirmed', user: me.user, quota: me.quota };
  }

  async confirmWechatAuth(input: WechatAuthCallbackDto, secret?: string) {
    this.assertWechatCallbackSecret(secret);
    const session = await this.prisma.wechatLoginSession.findUnique({ where: { state: input.state } });
    if (!session || session.status !== 'pending' || session.expiresAt <= new Date()) {
      throw new BadRequestException('Wechat login session is invalid or expired');
    }

    const providerUserId = input.openId.trim();
    const unionId = input.unionId?.trim() || null;
    const profile = {
      ...(input.profile ?? {}),
      nickname: input.nickname,
      avatarUrl: input.avatarUrl,
      openId: providerUserId,
      unionId
    } as Prisma.InputJsonObject;

    const identity = await this.findWechatIdentity(providerUserId, unionId);
    let user = identity ? await this.storage.getUserById(identity.userId) : null;
    if (!user) {
      user = await this.storage.addUser(this.storage.createStoredUser({
        id: randomUUID(),
        email: input.email ? this.normalizeEmail(input.email) : null,
        role: 'user',
        status: 'active',
        isGuest: false,
        emailVerifiedAt: input.email ? new Date().toISOString() : null
      }));
    }

    await this.prisma.externalIdentity.upsert({
      where: { provider_providerUserId: { provider: 'wechat', providerUserId } },
      update: { userId: user.id, unionId, profile },
      create: { userId: user.id, provider: 'wechat', providerUserId, unionId, profile }
    });

    await this.prisma.wechatLoginSession.update({
      where: { state: input.state },
      data: {
        status: 'confirmed',
        userId: user.id,
        confirmedAt: new Date()
      }
    });
    return { ok: true };
  }

  async ensureRequestUser(req: AuthenticatedRequest, res?: Response): Promise<AuthUser> {
    if (req.authUser) return req.authUser;

    const token = this.readToken(req);
    if (token) {
      const payload = this.verifySession(token);
      if (payload) {
        const stored = await this.storage.getUserById(payload.sub);
        if (stored?.status === 'active') {
          req.authUser = this.toPublicUser(stored);
          return req.authUser;
        }
      }
    }

    const guest = this.storage.createStoredUser({
      id: randomUUID(),
      email: null,
      role: 'guest',
      isGuest: true
    });
    await this.storage.addUser(guest);
    if (res) this.setSessionCookie(res, guest);
    req.authUser = this.toPublicUser(guest);
    return req.authUser;
  }

  async requireUser(req: AuthenticatedRequest): Promise<AuthUser> {
    const token = this.readToken(req);
    const payload = token ? this.verifySession(token) : null;
    const stored = payload ? await this.storage.getUserById(payload.sub) : null;
    if (!stored || stored.status !== 'active') {
      throw new UnauthorizedException('Authentication required');
    }
    req.authUser = this.toPublicUser(stored);
    return req.authUser;
  }

  async withQuota(user: AuthUser): Promise<AuthMeResponse> {
    const dailyTotal = user.role === 'guest' ? 3 : user.role === 'admin' ? 999 : 10;
    const datePrefix = new Date().toISOString().slice(0, 10);
    const dailyUsed = await this.storage.countDailyJobs(user.id, datePrefix);
    return {
      user,
      quota: {
        dailyTotal,
        dailyUsed,
        remaining: Math.max(0, dailyTotal - dailyUsed)
      }
    };
  }

  toPublicUser(user: StoredUser): AuthUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      isGuest: user.isGuest,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  private setSessionCookie(res: Response, user: StoredUser) {
    const token = this.signSession({
      sub: user.id,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds
    });
    res.cookie(sessionCookieName, token, this.cookieOptions());
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.APP_ENV === 'production',
      path: '/',
      maxAge: sessionTtlSeconds * 1000
    };
  }

  private readToken(req: AuthenticatedRequest) {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length);
    return this.parseCookies(req.headers.cookie ?? '')[sessionCookieName];
  }

  private parseCookies(header: string) {
    return header.split(';').reduce<Record<string, string>>((cookies, part) => {
      const [rawKey, ...rawValue] = part.trim().split('=');
      if (!rawKey) return cookies;
      cookies[rawKey] = decodeURIComponent(rawValue.join('='));
      return cookies;
    }, {});
  }

  private signSession(payload: SessionPayload) {
    const encodedPayload = this.base64url(JSON.stringify(payload));
    const signature = this.sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  private verifySession(token: string): SessionPayload | null {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature || !this.safeEqual(signature, this.sign(encodedPayload))) return null;
    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;
      if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  private sign(input: string) {
    return createHmac('sha256', this.secret()).update(input).digest('base64url');
  }

  private secret() {
    return process.env.JWT_SECRET || process.env.COOKIE_SECRET || 'picup-dev-secret';
  }

  private base64url(input: string) {
    return Buffer.from(input, 'utf8').toString('base64url');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('base64url');
    const hash = pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('base64url');
    return `pbkdf2_sha256$120000$${salt}$${hash}`;
  }

  private hashOneTimeCode(code: string) {
    return createHmac('sha256', `${this.secret()}:email-code`).update(code).digest('base64url');
  }

  private verifyPassword(password: string, stored: string) {
    const [algorithm, iterations, salt, expected] = stored.split('$');
    if (algorithm !== 'pbkdf2_sha256' || !iterations || !salt || !expected) return false;
    const hash = pbkdf2Sync(password, salt, Number(iterations), 32, 'sha256').toString('base64url');
    return this.safeEqual(hash, expected);
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private async deliverEmailCode(email: string, code: string, mode: string) {
    const webhook = process.env.EMAIL_DELIVERY_WEBHOOK_URL;
    if (!webhook) {
      console.log(`[auth] dev email code email=${email} mode=${mode} code=${code}`);
      return false;
    }

    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EMAIL_DELIVERY_WEBHOOK_SECRET
          ? { Authorization: `Bearer ${process.env.EMAIL_DELIVERY_WEBHOOK_SECRET}` }
          : {})
      },
      body: JSON.stringify({
        to: email,
        code,
        mode,
        expiresInSeconds: Math.floor(emailChallengeTtlMs / 1000)
      })
    });
    if (!response.ok) throw new BadRequestException('Email delivery failed');
    return true;
  }

  private buildWechatQrUrl(state: string, callbackUrl: string) {
    const template = process.env.WECHAT_SCAN_URL_TEMPLATE?.trim();
    if (template) {
      return template
        .replaceAll('{state}', encodeURIComponent(state))
        .replaceAll('{callbackUrl}', encodeURIComponent(callbackUrl));
    }
    const base = process.env.WECHAT_SCAN_BASE_URL?.trim() || 'https://wechat.example.com/scan-login';
    const url = new URL(base);
    url.searchParams.set('state', state);
    url.searchParams.set('callbackUrl', callbackUrl);
    return url.toString();
  }

  private assertWechatCallbackSecret(secret?: string) {
    const expected = process.env.WECHAT_AUTH_CALLBACK_SECRET;
    if (!expected) return;
    if (!secret || !this.safeEqual(secret, expected)) {
      throw new UnauthorizedException('Invalid wechat callback secret');
    }
  }

  private async findWechatIdentity(openId: string, unionId?: string | null) {
    return this.prisma.externalIdentity.findFirst({
      where: {
        provider: 'wechat',
        OR: [
          { providerUserId: openId },
          ...(unionId ? [{ unionId }] : [])
        ]
      }
    });
  }

  private roleForEmail(email: string, fallback: UserRole = 'user'): UserRole {
    const admins = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    return admins.includes(email) ? 'admin' : fallback === 'admin' ? 'admin' : 'user';
  }
}
