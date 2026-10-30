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
import { StorageService, type StoredUser, type VisitorMetadata } from '../../common/storage.service';
import { PrismaService } from '../../common/database/prisma.service';
import { clientIp } from '../../common/request-ip';
import { configuredSuperAdminEmails, sessionSecret } from '../../common/runtime-config';
import type { AuthenticatedRequest } from './auth.types';
import type { WechatAuthCallbackDto } from './dto';

interface SessionPayload {
  sub: string;
  sid: string; // server-side session ID for revocation checks
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
// Visit tracking writes the caller's own users row. Polling clients hit guarded
// endpoints every few seconds, so throttle the write instead of touching the
// same hot row on every request.
const visitTouchIntervalMs = 5 * 60 * 1000;
const readOnlyMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const ip9Endpoint = 'https://ip9.com.cn/get';
const wechatPendingPrefix = 'pending:';
export const creditRechargePlans = [
  // { id: 'credits_10_trial' as const, title: '10 积分', amountCents: 10, credits: 10 },
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
    const result = await this.withQuota(user);
    const identity = user.isGuest ? null : await this.prisma.externalIdentity.findFirst({ where: { userId: user.id, provider: 'wechat' } });
    const profile = (identity?.profile ?? {}) as Record<string, unknown>;
    return { ...result, user: { ...result.user, avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : null, wechatBound: Boolean(identity) } } as AuthMeResponse;
  }

  private async profileIdentity(req: AuthenticatedRequest) {
    const user = await this.requireUser(req);
    if (user.isGuest) throw new UnauthorizedException('请先登录');
    const identity = await this.prisma.externalIdentity.findFirst({ where: { userId: user.id, provider: 'wechat' } });
    if (!identity) throw new BadRequestException('当前账户未绑定微信');
    return { user, identity, profile: (identity.profile ?? {}) as Record<string, Prisma.InputJsonValue> };
  }

  async authorizeWechatProfile(req: AuthenticatedRequest) {
    const { user, identity } = await this.profileIdentity(req);
    const grant = await this.requestWxmid<{ authorization_url: string; authorization_id: string; expires_at: string }>('/profile/authorize/', {
      method: 'POST', body: JSON.stringify({ app_code: this.wxmidAppCode(), app_user_id: user.id, return_url: new URL('/?view=account', process.env.WEB_PUBLIC_URL || 'http://localhost:3000').toString() })
    });
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM external_identities WHERE id = ${identity.id}::uuid FOR UPDATE`;
      const latest = await tx.externalIdentity.findUniqueOrThrow({ where: { id: identity.id } });
      const profile = (latest.profile ?? {}) as Record<string, Prisma.InputJsonValue>;
      await tx.externalIdentity.update({ where: { id: identity.id }, data: { profile: { ...profile, profileGrantId: grant.authorization_id } } });
    });
    return grant;
  }

  async syncWechatProfile(req: AuthenticatedRequest) {
    const { user, identity, profile } = await this.profileIdentity(req);
    if (typeof profile.profileGrantId !== 'string') return { status: 'idle' };
    const result = await this.requestWxmid<{ status: string; nickname?: string; avatar?: string }>('/profile/authorization-status/?' + new URLSearchParams({ authorization_id: profile.profileGrantId }));
    if (result.status === 'succeeded') {
      if (typeof result.nickname !== 'string' || typeof result.avatar !== 'string') throw new ServiceUnavailableException('微信资料暂不可用');
      await this.prisma.$transaction(async tx => {
        // A repeated poll must not overwrite a later manual edit of the display name.
        await tx.$queryRaw`SELECT id FROM external_identities WHERE id = ${identity.id}::uuid FOR UPDATE`;
        const latest = await tx.externalIdentity.findUnique({ where: { id: identity.id } });
        const latestProfile = (latest?.profile ?? {}) as Record<string, Prisma.InputJsonValue>;
        if (latestProfile.profileGrantId !== profile.profileGrantId) return;
        await tx.user.update({ where: { id: user.id }, data: { displayName: result.nickname!.slice(0, 120) } });
        await tx.externalIdentity.update({ where: { id: identity.id }, data: { profile: { ...latestProfile, profileGrantId: null, avatarUrl: result.avatar!, nickname: result.nickname! } } });
      });
    }
    return { status: result.status };
  }

  async register(_input: AuthCredentials, _res: Response, _req?: AuthenticatedRequest): Promise<AuthMeResponse> {
    throw new BadRequestException('请通过邮箱验证码完成注册');
  }

  async login(input: AuthCredentials, res: Response, req?: AuthenticatedRequest): Promise<AuthMeResponse> {
    const email = this.normalizeEmail(input.email);
    const user = await this.storage.getUserByEmail(email);
    if (!user || user.isGuest || !user.passwordHash || !this.verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('User is disabled');
    }

    const visitedUser = req ? await this.touchUserVisit(user, req, true) : user;
    await this.transferGuestFiles(req, visitedUser.id);
    await this.setSessionCookie(res, visitedUser);
    return this.withQuota(this.toPublicUser(visitedUser));
  }

  logout(res: Response, req?: AuthenticatedRequest) {
    // Revoke the server-side session so the cookie cannot be replayed after logout.
    const token = req ? this.readToken(req) : null;
    const payload = token ? this.verifySessionSignature(token) : null;
    if (payload?.sid) {
      this.revokeSession(payload.sid).catch((err) =>
        console.error('[auth] logout session revoke failed', err)
      );
    }
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
      if (existing && existing.status !== 'active') {
        throw new UnauthorizedException('此账户暂时无法使用，请联系管理员');
      }
      if (existing && !existing.isGuest) {
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

  async verifyEmailAuth(input: EmailAuthVerifyRequest, res: Response, req?: AuthenticatedRequest): Promise<AuthMeResponse> {
    const challenge = await this.prisma.emailAuthChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) {
      throw new BadRequestException('Verification code is invalid or expired');
    }
    if (!['register', 'login'].includes(challenge.mode)) {
      throw new BadRequestException('验证码用途不匹配');
    }
    await this.consumeEmailCode(challenge.id, input.code);

    const email = this.normalizeEmail(challenge.email);
    const existing = await this.storage.getUserByEmail(email);
    let user: StoredUser;
    if (challenge.mode === 'register') {
      if (existing && existing.status !== 'active') {
        throw new UnauthorizedException('此账户暂时无法使用，请联系管理员');
      }
      if (existing && !existing.isGuest) {
        throw new ConflictException('Email is already registered');
      }
      user = await this.storage.addUser(this.storage.createStoredUser({
          id: randomUUID(),
          email,
          role: 'user',
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

    await this.transferGuestFiles(req, user.id);
    await this.prisma.emailAuthChallenge.update({ where: { id: challenge.id }, data: { userId: user.id } });
    const visitedUser = req ? await this.touchUserVisit(user, req, true) : user;
    await this.setSessionCookie(res, visitedUser);
    return this.withQuota(this.toPublicUser(visitedUser));
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

  async getWechatStatus(state: string, res: Response, req?: AuthenticatedRequest): Promise<WechatAuthStatusResponse> {
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
      return this.consumeConfirmedWechatSession(session.userId, state, res, req);
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
      return this.consumeConfirmedWechatSession(userId, state, res, req);
    }

    if (statusPayload.status === 'login_not_bound') {
      const userId = await this.syncWechatFirstLogin(statusPayload, req);
      await this.prisma.wechatLoginSession.update({
        where: { state },
        data: {
          status: 'confirmed',
          userId,
          confirmedAt: new Date()
        }
      });
      return this.consumeConfirmedWechatSession(userId, state, res, req);
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
      const payload = await this.verifySession(token);
      if (payload) {
        const stored = await this.storage.getUserById(payload.sub);
        if (stored?.status === 'active') {
          const visited = await this.touchUserVisit(stored, req);
          req.authUser = this.toPublicUser(visited);
          return req.authUser;
        }
      }
    }

    // Anonymous reads get a throwaway guest: GET handlers only query by user id, so nothing
    // needs to exist in the database. A guest row is created on the first write instead, which
    // keeps page views, crawlers and post-logout visits from filling the users table.
    if (readOnlyMethods.has(req.method)) {
      req.authUser = this.toPublicUser(this.storage.createStoredUser({ id: randomUUID(), email: null, role: 'guest', isGuest: true }));
      return req.authUser;
    }

    const guest = this.storage.createStoredUser({
      id: randomUUID(),
      email: null,
      role: 'guest',
      isGuest: true,
      visitor: await this.visitorMetadata(req)
    });
    await this.storage.addUser(guest);
    if (res) await this.setSessionCookie(res, guest);
    req.authUser = this.toPublicUser(guest);
    return req.authUser;
  }

  async requireUser(req: AuthenticatedRequest): Promise<AuthUser> {
    const token = this.readToken(req);
    const payload = token ? await this.verifySession(token) : null;
    const stored = payload ? await this.storage.getUserById(payload.sub) : null;
    if (!stored || stored.status !== 'active') {
      throw new UnauthorizedException('Authentication required');
    }
    req.authUser = this.toPublicUser(stored);
    return req.authUser;
  }

  private async consumeEmailCode(id: string, code: string) {
    // Reserve an attempt atomically, including successful attempts. Concurrent
    // requests cannot all pass a stale attempts/consumedAt check.
    const attempt = await this.prisma.emailAuthChallenge.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } }
    });
    if (attempt.count !== 1) throw new BadRequestException('验证码已使用、已过期或尝试次数过多，请重新获取');
    const consumed = await this.prisma.emailAuthChallenge.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() }, codeHash: this.hashOneTimeCode(code.trim()) },
      data: { consumedAt: new Date() }
    });
    if (consumed.count !== 1) throw new BadRequestException('验证码错误或已使用，请重新获取');
  }

  async startProfileEmailChange(req: AuthenticatedRequest, input: { email: string }) {
    const user = await this.requireUser(req);
    if (user.isGuest) throw new UnauthorizedException('Authentication required');
    const email = this.normalizeEmail(input.email);
    const existing = await this.storage.getUserByEmail(email);
    if (existing && existing.id !== user.id) throw new ConflictException('该邮箱已被使用');
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + emailChallengeTtlMs);
    const challenge = await this.prisma.emailAuthChallenge.create({ data: {
      email, mode: 'change-email', userId: user.id, codeHash: this.hashOneTimeCode(code), expiresAt
    } });
    const delivered = await this.deliverEmailCode(email, code, 'change-email');
    return { challengeId: challenge.id, email, expiresAt: expiresAt.toISOString(),
      ...(!delivered && process.env.APP_ENV !== 'production' ? { devCode: code } : {}) };
  }

  async updateProfile(req: AuthenticatedRequest, input: {
    displayName?: string;
    email?: string;
    password?: string;
    emailChallengeId?: string;
    emailCode?: string;
  }, res: Response): Promise<AuthMeResponse> {
    const current = await this.requireUser(req);
    const stored = await this.storage.getUserById(current.id);
    if (!stored || stored.isGuest) throw new UnauthorizedException('Authentication required');

    const nextEmail = input.email?.trim() ? this.normalizeEmail(input.email) : stored.email;
    if (nextEmail && nextEmail !== stored.email) {
      const existing = await this.storage.getUserByEmail(nextEmail);
      if (existing && existing.id !== stored.id) throw new ConflictException('该邮箱已被使用');
      const challenge = input.emailChallengeId
        ? await this.prisma.emailAuthChallenge.findUnique({ where: { id: input.emailChallengeId } }) : null;
      if (!challenge || challenge.mode !== 'change-email' || challenge.userId !== stored.id || challenge.email !== nextEmail || !input.emailCode) {
        throw new BadRequestException('请先获取并填写新邮箱的验证码');
      }
      await this.consumeEmailCode(challenge.id, input.emailCode);
    }

    const passwordChanged = Boolean(input.password);
    const updated = await this.storage.updateUser(stored.id, {
      ...(nextEmail !== stored.email ? { email: nextEmail, emailVerifiedAt: new Date().toISOString() } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName?.trim() || null } : {}),
      ...(input.password ? { passwordHash: this.hashPassword(input.password) } : {})
    });

    // Revoke all existing sessions when password changes so other devices are signed out.
    if (passwordChanged) {
      await this.revokeAllUserSessions(updated.id);
    }

    await this.createSession(res, updated);
    return this.withQuota(this.toPublicUser(updated));
  }

  async withQuota(user: AuthUser): Promise<AuthMeResponse> {
    const dailyTotal = user.isGuest ? 0 : user.role === 'admin' || user.quotaUnlimited ? unlimitedQuota : 1;
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
      isSuperAdmin: this.isSuperAdmin(user),
      status: user.status,
      isGuest: user.isGuest,
      quotaUnlimited: user.quotaUnlimited,
      creditBalance: user.creditBalance,
      emailVerifiedAt: user.emailVerifiedAt,
      lastIp: user.lastIp,
      lastCountry: user.lastCountry,
      lastRegion: user.lastRegion,
      lastCity: user.lastCity,
      lastSeenAt: user.lastSeenAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  isSuperAdmin(user: Pick<StoredUser | AuthUser, 'email' | 'role'>) {
    return user.role === 'admin' && Boolean(user.email && configuredSuperAdminEmails().includes(user.email.toLowerCase()));
  }

  private async visitorMetadata(req: AuthenticatedRequest, lookup = true): Promise<VisitorMetadata> {
    const ip = clientIp(req);
    const headerCountry = this.headerString(req.headers['cf-ipcountry'])
      || this.headerString(req.headers['x-vercel-ip-country'])
      || this.headerString(req.headers['x-appengine-country']);
    const headerRegion = this.headerString(req.headers['cf-region'])
      || this.headerString(req.headers['x-vercel-ip-country-region'])
      || this.headerString(req.headers['x-appengine-region']);
    const headerCity = this.headerString(req.headers['cf-ipcity'])
      || this.headerString(req.headers['x-vercel-ip-city'])
      || this.headerString(req.headers['x-appengine-city']);
    const ip9 = lookup ? await this.lookupIp9(ip) : {};
    return {
      ip,
      country: ip9.country || headerCountry,
      region: ip9.region || headerRegion,
      city: ip9.city || headerCity
    };
  }

  async lookupIp(ip?: string): Promise<VisitorMetadata> {
    const ip9 = await this.lookupIp9(ip);
    return { ip, ...ip9 };
  }

  private async touchUserVisit(user: StoredUser, req: AuthenticatedRequest, force = false): Promise<StoredUser> {
    const visitor = await this.visitorMetadata(req, false);
    if (!visitor.ip && !visitor.country && !visitor.region && !visitor.city) return user;
    const addressChanged = Boolean(visitor.ip) && visitor.ip !== user.lastIp;
    // Skip repeat visits from the same address. Geo backfill rides along with
    // the next write that does happen, so a failing lookup cannot defeat this.
    if (!force && !addressChanged && this.visitedRecently(user)) return user;
    const shouldLookup = visitor.ip && (
      addressChanged
      || !user.lastCountry
      || !user.lastRegion
      || !user.lastCity
    );
    const metadata = shouldLookup ? { ...visitor, ...(await this.lookupIp(visitor.ip)) } : { ip: visitor.ip };
    const updated = await this.storage.enrichUserIp(user.id, metadata);
    return updated ?? user;
  }

  private visitedRecently(user: StoredUser) {
    if (!user.lastSeenAt) return false;
    const seenAt = Date.parse(user.lastSeenAt);
    return Number.isFinite(seenAt) && Date.now() - seenAt < visitTouchIntervalMs;
  }

  private async lookupIp9(ip?: string): Promise<Omit<VisitorMetadata, 'ip'>> {
    if (!ip) return {};
    try {
      const url = new URL(ip9Endpoint);
      url.searchParams.set('ip', ip);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return {};
      const payload = await response.json() as {
        ret?: number;
        data?: {
          country?: string;
          prov?: string;
          city?: string;
        };
      };
      if (payload.ret !== 200 || !payload.data) return {};
      return {
        country: payload.data.country,
        region: payload.data.prov,
        city: payload.data.city
      };
    } catch {
      return {};
    }
  }

  private headerString(value: string | string[] | undefined) {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.trim() || undefined;
  }

  private setSessionCookie(res: Response, user: StoredUser): Promise<string> {
    return this.createSession(res, user);
  }

  private async createSession(res: Response, user: StoredUser): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + sessionTtlSeconds;
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(exp * 1000)
      }
    });
    const token = this.signSession({
      sub: user.id,
      sid: session.id,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp
    });
    res.cookie(sessionCookieName, token, this.cookieOptions());
    return session.id;
  }

  private async revokeSession(sid: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sid, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  private async revokeAllUserSessions(userId: string): Promise<void> {
    return this.revokeAllSessionsForUser(userId);
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

  private verifySessionSignature(token: string): SessionPayload | null {
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

  private async verifySession(token: string): Promise<SessionPayload | null> {
    const payload = this.verifySessionSignature(token);
    if (!payload) return null;
    if (!payload.sid) return payload; // legacy token without sid — allow during migration
    const session = await this.prisma.userSession.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    return payload;
  }

  private sign(input: string) {
    return createHmac('sha256', this.secret()).update(input).digest('base64url');
  }

  private secret() {
    return sessionSecret();
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
    const actionText = mode === 'change-email' ? '修改邮箱' : mode === 'register' ? '注册' : '登录';
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

    const actionText = mode === 'change-email' ? '修改邮箱' : mode === 'register' ? '注册' : '登录';
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
    const expected = process.env.WECHAT_AUTH_CALLBACK_SECRET?.trim();
    if (!expected) {
      throw new ServiceUnavailableException('Wechat callback authentication is not configured');
    }
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

  private async transferGuestFiles(req: AuthenticatedRequest | undefined, userId: string) {
    if (!req) return;
    const token = this.readToken(req);
    // Use the synchronous signature check only — we don't need DB revocation here
    // because guest file transfer is a best-effort migration, not a security gate.
    const payload = token ? this.verifySessionSignature(token) : null;
    if (payload) await this.storage.transferGuestFiles(payload.sub, userId);
  }

  private async consumeConfirmedWechatSession(userId: string, state: string, res: Response, req?: AuthenticatedRequest): Promise<WechatAuthStatusResponse> {
    let stored = await this.storage.getUserById(userId);
    if (!stored || stored.status !== 'active') throw new UnauthorizedException('User is not active');
    if (stored.isGuest || stored.role === 'guest') {
      stored = await this.storage.updateUser(stored.id, { isGuest: false, role: 'user' });
    }
    await this.transferGuestFiles(req, stored.id);
    await this.prisma.wechatLoginSession.update({
      where: { state },
      data: { status: 'consumed', consumedAt: new Date() }
    });
    await this.setSessionCookie(res, stored);
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

  private async syncWechatFirstLogin(payload: WxmidQrStatusPayload, req?: AuthenticatedRequest) {
    const openId = payload.openid?.trim();
    if (!openId) {
      throw new BadRequestException('Wechat login succeeded without openid');
    }

    const token = req ? this.readToken(req) : null;
    const guestId = token ? (this.verifySessionSignature(token))?.sub : undefined;
    const userId = await this.prisma.$transaction(async tx => {
      // Serialize first registration across API processes before creating an account.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wechat:${openId}`}, 0))::text`;
      const identity = await tx.externalIdentity.findUnique({
        where: { provider_providerUserId: { provider: 'wechat', providerUserId: openId } }
      });
      if (identity) return identity.userId;
      if (guestId) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`guest:${guestId}`}, 0))::text`;
      }
      const guest = guestId ? await tx.user.findUnique({ where: { id: guestId } }) : null;
      const user = guest?.isGuest && guest.status === 'active'
        ? await tx.user.update({ where: { id: guest.id }, data: { isGuest: false, role: 'user' } })
        : await tx.user.create({ data: { role: 'user', isGuest: false, status: 'active' } });
      await tx.externalIdentity.create({ data: {
        userId: user.id, provider: 'wechat', providerUserId: openId, profile: { openId }
      } });
      return user.id;
    });

    await this.requestWxmid('/sync-bind/', {
      method: 'POST',
      body: JSON.stringify({
        app_code: this.wxmidAppCode(),
        app_user_id: userId,
        openid: openId
      })
    });

    return userId;
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
        signal: AbortSignal.timeout(15000),
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
