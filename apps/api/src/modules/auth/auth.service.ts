import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import type { Response } from 'express';
import { createHmac, pbkdf2Sync, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
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

interface WxmidEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

interface WxmidQrCodePayload {
  qrcode_url: string;
  scene_key: string;
}

interface WxmidQrStatusPayload {
  status: 'pending' | 'bound' | 'login_ok' | 'login_not_bound' | 'error';
  message?: string;
  openid?: string;
  app_user_id?: string;
}

const sessionCookieName = 'picup_session';
const sessionTtlSeconds = 60 * 60 * 24 * 30;
const emailChallengeTtlMs = 10 * 60 * 1000;
const wechatSessionTtlMs = 5 * 60 * 1000;
const unlimitedQuota = 999999999;
const builtInAdminEmails = ['1315410762@qq.com'];
const wechatPendingPrefix = 'pending:';
export const creditRechargePlans = [
  { id: 'credits_10_trial' as const, title: '10 积分', amountCents: 10, credits: 10 },
  { id: 'credits_20' as const, title: '20 积分', amountCents: 990, credits: 20 },
  { id: 'credits_45' as const, title: '45 积分', amountCents: 1990, credits: 45 }
];
export const singleUsePriceCents = 50;

@Injectable()
export class AuthService {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService
  ) {}

  async me(req: AuthenticatedRequest, res: Response): Promise<AuthMeResponse> {
    const user = await this.ensureRequestUser(req, res);
    return this.withQuota(user);
  }

  async register(input: AuthCredentials, res: Response): Promise<AuthMeResponse> {
    if (input.termsAccepted !== true) {
      throw new BadRequestException('注册前请先阅读并同意用户协议和隐私政策');
    }

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
    res.cookie(sessionCookieName, '', {
      ...this.clearCookieOptions(),
      maxAge: 0,
      expires: new Date(0)
    });
    return { ok: true };
  }

  async startEmailAuth(input: EmailAuthStartRequest): Promise<EmailAuthStartResponse> {
    const email = this.normalizeEmail(input.email);
    const mode = input.mode;
    const existing = await this.storage.getUserByEmail(email);

    if (mode === 'register') {
      if (input.termsAccepted !== true) {
        throw new BadRequestException('注册前请先阅读并同意用户协议和隐私政策');
      }
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
    this.assertWxmidConfigured();
    const state = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + wechatSessionTtlMs);
    const qrCode = await this.requestWxmid<WxmidQrCodePayload>('/qrcode/', {
      method: 'POST',
      body: JSON.stringify({
        app_code: this.wxmidAppCode(),
        mode: 'login'
      })
    });
    let session;
    try {
      session = await this.prisma.wechatLoginSession.create({
        data: {
          state,
          status: `${wechatPendingPrefix}${qrCode.scene_key}`,
          qrCodeUrl: qrCode.qrcode_url,
          expiresAt
        }
      });
    } catch (error) {
      throw new BadRequestException(`Wechat login session create failed: ${this.errorMessage(error)}`);
    }
    return {
      state,
      qrCodeUrl: session.qrCodeUrl,
      expiresAt: expiresAt.toISOString()
    };
  }

  async getWechatStatus(state: string, res: Response): Promise<WechatAuthStatusResponse> {
    const session = await this.prisma.wechatLoginSession.findUnique({ where: { state } });
    if (!session) {
      return {
        status: 'expired',
        message: 'Wechat login session expired. Please refresh and scan again.'
      };
    }
    if (session.consumedAt) return { status: 'consumed' };
    if (session.status === 'failed') {
      return { status: 'failed', message: 'Wechat login failed' };
    }
    if (session.expiresAt <= new Date() && session.status.startsWith(wechatPendingPrefix)) {
      await this.prisma.wechatLoginSession.update({ where: { state }, data: { status: 'expired' } });
      return { status: 'expired' };
    }
    if (session.status === 'confirmed' && session.userId) {
      return this.consumeConfirmedWechatSession(session.userId, state, res);
    }
    if (session.status === 'expired') return { status: 'expired' };

    const sceneKey = this.extractWechatSceneKey(session.status);
    if (!sceneKey) {
      await this.prisma.wechatLoginSession.update({ where: { state }, data: { status: 'failed' } });
      return { status: 'failed', message: 'Wechat login session is corrupted' };
    }

    let statusPayload: WxmidQrStatusPayload;
    try {
      statusPayload = await this.requestWxmid<WxmidQrStatusPayload>(`/qrcode/status/?scene_key=${encodeURIComponent(sceneKey)}`);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        return {
          status: 'pending',
          message: 'Wechat middleware is temporarily unavailable. Please keep waiting.'
        };
      }
      throw error;
    }
    if (statusPayload.status === 'pending') {
      return { status: 'pending', message: statusPayload.message ?? 'Waiting for WeChat scan' };
    }

    if (statusPayload.status === 'bound' || statusPayload.status === 'login_ok') {
      const userId = await this.resolveConfirmedWechatUserId(statusPayload);
      await this.prisma.wechatLoginSession.update({
        where: { state },
        data: {
          status: 'confirmed',
          userId,
          confirmedAt: new Date()
        }
      });
      return this.consumeConfirmedWechatSession(userId, state, res);
    }

    if (statusPayload.status === 'login_not_bound') {
      const userId = await this.syncWechatFirstLogin(statusPayload);
      await this.prisma.wechatLoginSession.update({
        where: { state },
        data: {
          status: 'confirmed',
          userId,
          confirmedAt: new Date()
        }
      });
      return this.consumeConfirmedWechatSession(userId, state, res);
    }

    await this.prisma.wechatLoginSession.update({ where: { state }, data: { status: 'failed' } });
    return {
      status: 'failed',
      message: statusPayload.message ?? 'Wechat login failed'
    };
  }

  async confirmWechatAuth(input: WechatAuthCallbackDto, secret?: string) {
    this.assertWechatCallbackSecret(secret);
    const session = await this.prisma.wechatLoginSession.findUnique({ where: { state: input.state } });
    if (!session || session.expiresAt <= new Date()) {
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

  async updateProfile(req: AuthenticatedRequest, input: {
    displayName?: string;
    email?: string;
    password?: string;
  }, res: Response): Promise<AuthMeResponse> {
    const current = await this.requireUser(req);
    const stored = await this.storage.getUserById(current.id);
    if (!stored || stored.isGuest) throw new UnauthorizedException('Authentication required');

    const nextEmail = input.email?.trim() ? this.normalizeEmail(input.email) : stored.email;
    if (nextEmail && nextEmail !== stored.email) {
      const existing = await this.storage.getUserByEmail(nextEmail);
      if (existing && existing.id !== stored.id) throw new ConflictException('Email is already registered');
    }

    const updated = await this.storage.updateUser({
      ...stored,
      email: nextEmail,
      displayName: input.displayName?.trim() || null,
      passwordHash: input.password ? this.hashPassword(input.password) : stored.passwordHash,
      updatedAt: new Date().toISOString()
    });
    this.setSessionCookie(res, updated);
    return this.withQuota(this.toPublicUser(updated));
  }

  async withQuota(user: AuthUser): Promise<AuthMeResponse> {
    const dailyTotal = user.role === 'guest' ? 3 : user.role === 'admin' || user.quotaUnlimited ? unlimitedQuota : 10;
    const datePrefix = new Date().toISOString().slice(0, 10);
    const dailyUsed = await this.storage.countDailyJobs(user.id, datePrefix);
    return {
      user,
      quota: {
        dailyTotal,
        dailyUsed,
        remaining: Math.max(0, dailyTotal - dailyUsed)
      },
      credits: {
        balance: user.creditBalance,
        rechargePlans: creditRechargePlans,
        singleUsePriceCents
      }
    };
  }

  toPublicUser(user: StoredUser): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      isGuest: user.isGuest,
      quotaUnlimited: user.quotaUnlimited,
      creditBalance: user.creditBalance,
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

  private clearCookieOptions() {
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    return options;
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
    if (this.isSmtpConfigured()) {
      await this.deliverEmailCodeBySmtpWithFallback(email, code, mode);
      return true;
    }

    if (process.env.EMAIL_DELIVERY_WEBHOOK_URL) {
      await this.deliverEmailCodeByWebhook(email, code, mode);
      return true;
    }

    if (process.env.APP_ENV !== 'production') {
      console.log(`[auth] dev email code email=${email} mode=${mode} code=${code}`);
      return false;
    }

    throw new BadRequestException('Email delivery is not configured');
  }

  private async deliverEmailCodeByWebhook(email: string, code: string, mode: string) {
    const response = await fetch(process.env.EMAIL_DELIVERY_WEBHOOK_URL as string, {
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
  }

  private async deliverEmailCodeBySmtpWithFallback(email: string, code: string, mode: string) {
    const host = process.env.SMTP_HOST as string;
    const port = this.envNumber('SMTP_PORT', 587);
    const user = process.env.SMTP_USER as string;
    const pass = process.env.SMTP_PASS as string;
    const from = process.env.SMTP_FROM?.trim() || user;
    const appName = process.env.APP_NAME?.trim() || 'PicUp';
    const secure = this.envFlag('SMTP_SECURE', port === 465);
    const requireTLS = this.envFlag('SMTP_REQUIRE_TLS', port === 587 && !secure);
    const authMethod = process.env.SMTP_AUTH_METHOD?.trim();
    const actionText = mode === 'register' ? '注册' : '登录';
    const expiresInMinutes = Math.floor(emailChallengeTtlMs / 60_000);
    const message = {
      from,
      to: email,
      subject: `${appName} ${actionText}验证码`,
      text: [
        `你的 ${appName} ${actionText}验证码是：${code}`,
        `验证码 ${expiresInMinutes} 分钟内有效。`,
        '如果不是你本人操作，请忽略这封邮件。'
      ].join('\n'),
      html: [
        `<p>你的 <strong>${appName}</strong> ${actionText}验证码是：</p>`,
        `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p>`,
        `<p>验证码 ${expiresInMinutes} 分钟内有效。</p>`,
        '<p>如果不是你本人操作，请忽略这封邮件。</p>'
      ].join('')
    };

    const common = {
      host,
      user,
      pass,
      authMethod,
      message,
      connectionTimeout: this.envNumber('SMTP_CONNECTION_TIMEOUT_MS', 30000),
      greetingTimeout: this.envNumber('SMTP_GREETING_TIMEOUT_MS', 30000),
      socketTimeout: this.envNumber('SMTP_SOCKET_TIMEOUT_MS', 60000),
      rejectUnauthorized: this.envFlag('SMTP_REJECT_UNAUTHORIZED', true)
    };

    try {
      await this.sendSmtpMessage({ ...common, port, secure, requireTLS });
      return;
    } catch (error) {
      if (!secure && port !== 465 && this.isSmtpUnexpectedClose(error)) {
        try {
          await this.sendSmtpMessage({
            ...common,
            port: this.envNumber('SMTP_SSL_FALLBACK_PORT', 465),
            secure: true,
            requireTLS: false
          });
          return;
        } catch (fallbackError) {
          throw new BadRequestException(`Email delivery failed: ${this.errorMessage(fallbackError)}`);
        }
      }

      throw new BadRequestException(`Email delivery failed: ${this.errorMessage(error)}`);
    }
  }

  private async sendSmtpMessage(input: {
    host: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
    user: string;
    pass: string;
    authMethod?: string;
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
    rejectUnauthorized: boolean;
    message: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    };
  }) {
    const transporter = nodemailer.createTransport({
      host: input.host,
      port: input.port,
      secure: input.secure,
      requireTLS: input.requireTLS,
      auth: { user: input.user, pass: input.pass },
      ...(input.authMethod ? { authMethod: input.authMethod } : {}),
      connectionTimeout: input.connectionTimeout,
      greetingTimeout: input.greetingTimeout,
      socketTimeout: input.socketTimeout,
      tls: {
        rejectUnauthorized: input.rejectUnauthorized
      }
    });

    await transporter.sendMail(input.message);
  }

  private isSmtpUnexpectedClose(error: unknown) {
    const message = this.errorMessage(error).toLowerCase();
    return (
      message.includes('unexpected socket close') ||
      message.includes('unexpectedly closed') ||
      message.includes('connection closed') ||
      message.includes('greeting never received')
    );
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  private async deliverEmailCodeBySmtp(email: string, code: string, mode: string) {
    const host = process.env.SMTP_HOST as string;
    const port = this.envNumber('SMTP_PORT', 587);
    const user = process.env.SMTP_USER as string;
    const pass = process.env.SMTP_PASS as string;
    const from = process.env.SMTP_FROM?.trim() || user;
    const appName = process.env.APP_NAME?.trim() || 'PicUp';
    const secure = this.envFlag('SMTP_SECURE', port === 465);
    const requireTLS = this.envFlag('SMTP_REQUIRE_TLS', port === 587 && !secure);
    const authMethod = process.env.SMTP_AUTH_METHOD?.trim();

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS,
      auth: { user, pass },
      ...(authMethod ? { authMethod } : {}),
      connectionTimeout: this.envNumber('SMTP_CONNECTION_TIMEOUT_MS', 30000),
      greetingTimeout: this.envNumber('SMTP_GREETING_TIMEOUT_MS', 30000),
      socketTimeout: this.envNumber('SMTP_SOCKET_TIMEOUT_MS', 60000),
      tls: {
        rejectUnauthorized: this.envFlag('SMTP_REJECT_UNAUTHORIZED', true)
      }
    });

    const actionText = mode === 'register' ? '注册' : '登录';
    const expiresInMinutes = Math.floor(emailChallengeTtlMs / 60_000);
    await transporter.sendMail({
      from,
      to: email,
      subject: `${appName} ${actionText}验证码`,
      text: [
        `你的 ${appName} ${actionText}验证码是：${code}`,
        `验证码 ${expiresInMinutes} 分钟内有效。`,
        '如果不是你本人操作，请忽略这封邮件。'
      ].join('\n'),
      html: [
        `<p>你的 <strong>${appName}</strong> ${actionText}验证码是：</p>`,
        `<p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p>`,
        `<p>验证码 ${expiresInMinutes} 分钟内有效。</p>`,
        '<p>如果不是你本人操作，请忽略这封邮件。</p>'
      ].join('')
    });
  }

  private isSmtpConfigured() {
    return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
  }

  private envFlag(name: string, fallback: boolean) {
    const value = process.env[name]?.trim().toLowerCase();
    if (!value) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value);
  }

  private envNumber(name: string, fallback: number) {
    const value = Number(process.env[name]?.trim());
    return Number.isFinite(value) && value > 0 ? value : fallback;
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
    const admins = [
      ...builtInAdminEmails,
      ...(process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    ];
    return admins.includes(email) ? 'admin' : fallback === 'admin' ? 'admin' : 'user';
  }

  private async consumeConfirmedWechatSession(userId: string, state: string, res: Response): Promise<WechatAuthStatusResponse> {
    const stored = await this.storage.getUserById(userId);
    if (!stored || stored.status !== 'active') throw new UnauthorizedException('User is not active');
    await this.prisma.wechatLoginSession.update({
      where: { state },
      data: { status: 'consumed', consumedAt: new Date() }
    });
    this.setSessionCookie(res, stored);
    const me = await this.withQuota(this.toPublicUser(stored));
    return { status: 'confirmed', user: me.user, quota: me.quota };
  }

  private extractWechatSceneKey(status: string) {
    return status.startsWith(wechatPendingPrefix) ? status.slice(wechatPendingPrefix.length) : null;
  }

  private async resolveConfirmedWechatUserId(payload: WxmidQrStatusPayload) {
    const appUserId = payload.app_user_id?.trim();
    if (appUserId) {
      const byId = await this.storage.getUserById(appUserId);
      if (byId?.status === 'active') return byId.id;
    }

    const openId = payload.openid?.trim();
    if (!openId) {
      throw new BadRequestException('Wechat login succeeded without openid');
    }

    const identity = await this.findWechatIdentity(openId);
    if (!identity) {
      throw new BadRequestException('Wechat account is not linked to a local user');
    }
    return identity.userId;
  }

  private async syncWechatFirstLogin(payload: WxmidQrStatusPayload) {
    const openId = payload.openid?.trim();
    if (!openId) {
      throw new BadRequestException('Wechat login succeeded without openid');
    }

    const existingIdentity = await this.findWechatIdentity(openId);
    if (existingIdentity) {
      await this.requestWxmid('/sync-bind/', {
        method: 'POST',
        body: JSON.stringify({
          app_code: this.wxmidAppCode(),
          app_user_id: existingIdentity.userId,
          openid: openId
        })
      });
      return existingIdentity.userId;
    }

    const user = await this.storage.addUser(this.storage.createStoredUser({
      id: randomUUID(),
      email: null,
      role: 'user',
      status: 'active',
      isGuest: false
    }));

    await this.requestWxmid('/sync-bind/', {
      method: 'POST',
      body: JSON.stringify({
        app_code: this.wxmidAppCode(),
        app_user_id: user.id,
        openid: openId
      })
    });

    await this.prisma.externalIdentity.upsert({
      where: { provider_providerUserId: { provider: 'wechat', providerUserId: openId } },
      update: { userId: user.id, unionId: null, profile: { openId } },
      create: {
        userId: user.id,
        provider: 'wechat',
        providerUserId: openId,
        unionId: null,
        profile: { openId }
      }
    });

    return user.id;
  }

  private assertWxmidConfigured() {
    if (!this.wxmidBaseUrl() || !this.wxmidApiKey() || !this.wxmidAppCode()) {
      throw new BadRequestException('Wechat middleware is not configured. Check WXMID_URL, WXMID_KEY and WXMID_APP_CODE.');
    }
  }

  private wxmidBaseUrl() {
    return this.envString('WXMID_URL').replace(/\/$/, '');
  }

  private wxmidApiKey() {
    return this.envString('WXMID_KEY');
  }

  private wxmidAppCode() {
    return this.envString('WXMID_APP_CODE');
  }

  private envString(name: string) {
    const value = process.env[name] ?? process.env[`${name} `];
    return value?.trim().replace(/^"(.*)"$/, '$1') ?? '';
  }

  private async requestWxmid<T>(path: string, init?: RequestInit): Promise<T> {
    this.assertWxmidConfigured();
    const url = `${this.wxmidBaseUrl()}${path}`;
    let response: globalThis.Response;

    try {
      response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.wxmidApiKey(),
          ...(init?.headers ?? {})
        }
      });
    } catch (error) {
      throw new ServiceUnavailableException(`Wechat middleware is unreachable: ${this.errorMessage(error)}`);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Wechat middleware request failed: ${response.status}${detail ? ` ${detail}` : ''}`
      );
    }

    let payload: WxmidEnvelope<T>;
    try {
      payload = (await response.json()) as WxmidEnvelope<T>;
    } catch (error) {
      throw new ServiceUnavailableException(`Wechat middleware returned invalid JSON: ${this.errorMessage(error)}`);
    }

    if (payload.code !== 0) {
      throw new BadRequestException(payload.message || 'Wechat middleware request failed');
    }
    return payload.data;
  }
}
