'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, LogIn, MailCheck, QrCode, UserPlus } from 'lucide-react';
import {
  getWechatAuthStatus,
  login,
  startEmailAuth,
  startWechatAuth,
  verifyEmailAuth
} from '@/lib/api';
import { useNotifications } from '@/components/notification-provider';

type AuthTab = 'email-register' | 'password-login' | 'wechat';

export default function LoginPage() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [tab, setTab] = useState<AuthTab>('email-register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [wechatState, setWechatState] = useState<string | null>(null);
  const [wechatQrCodeUrl, setWechatQrCodeUrl] = useState<string | null>(null);
  const [wechatMessage, setWechatMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const redirectedAfterLogin = useRef(false);

  function afterLogin() {
    if (redirectedAfterLogin.current) return;
    redirectedAfterLogin.current = true;
    notifications.success('登录成功', '正在返回工作台');
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    window.setTimeout(() => {
      window.location.replace('/');
    }, 50);
  }

  const passwordLoginMutation = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: afterLogin,
    onError: (err) => {
      const message = err instanceof Error ? err.message : '登录失败，请稍后再试';
      setError(message);
      notifications.error('登录失败', message);
    }
  });

  const emailStartMutation = useMutation({
    mutationFn: () => startEmailAuth({ email, password, mode: 'register' }),
    onSuccess: (result) => {
      setChallengeId(result.challengeId);
      setCode('');
      setError(null);
      const message = result.devCode ? `开发环境验证码：${result.devCode}` : `验证码已发送到 ${result.email}`;
      setNotice(message);
      notifications.success('验证码已发送', message);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '验证码发送失败';
      setError(message);
      notifications.error('验证码发送失败', message);
    }
  });

  const emailVerifyMutation = useMutation({
    mutationFn: () => verifyEmailAuth({ challengeId: challengeId as string, code }),
    onSuccess: afterLogin,
    onError: (err) => {
      const message = err instanceof Error ? err.message : '验证码无效或已过期';
      setError(message);
      notifications.error('验证失败', message);
    }
  });

  const wechatStartMutation = useMutation({
    mutationFn: startWechatAuth,
    onSuccess: (result) => {
      setWechatState(result.state);
      setWechatQrCodeUrl(result.qrCodeUrl);
      setWechatMessage('请使用微信扫码确认登录');
      setError(null);
      setNotice(null);
      notifications.info('二维码已创建', '请使用微信扫码完成登录');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '微信扫码会话创建失败';
      setWechatMessage(null);
      setError(message);
      notifications.error('微信扫码会话创建失败', message);
    }
  });

  const wechatStatusQuery = useQuery({
    queryKey: ['wechat-auth', wechatState],
    queryFn: () => getWechatAuthStatus(wechatState as string),
    enabled: Boolean(wechatState),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'confirmed' || status === 'expired' || status === 'consumed' || status === 'failed'
        ? false
        : 2000;
    }
  });

  useEffect(() => {
    if (tab === 'wechat' && !wechatState && !wechatStartMutation.isPending) {
      refreshWechat();
    }
  }, [tab, wechatState, wechatStartMutation.isPending]);

  useEffect(() => {
    const data = wechatStatusQuery.data;
    if (!data) return;

    if (data.status === 'confirmed') {
      setWechatMessage(data.message || '扫码确认成功，正在登录...');
      afterLogin();
      return;
    }

    if (data.status === 'expired') {
      const message = data.message || '二维码已过期，请刷新后重新扫码';
      setWechatMessage(message);
      notifications.warning('二维码已过期', message);
      return;
    }

    if (data.status === 'failed') {
      const message = data.message || '微信扫码登录失败，请刷新二维码后重试';
      setWechatMessage(message);
      setError(message);
      notifications.error('微信扫码登录失败', message);
      return;
    }

    if (data.status === 'pending') {
      setWechatMessage(data.message || '等待微信扫码...');
    }
  }, [wechatStatusQuery.data]);

  function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || password.length < 8 || passwordLoginMutation.isPending) return;
    setError(null);
    passwordLoginMutation.mutate();
  }

  function submitEmailStart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || password.length < 8 || emailStartMutation.isPending) return;
    setError(null);
    emailStartMutation.mutate();
  }

  function submitEmailVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId || code.trim().length < 4 || emailVerifyMutation.isPending) return;
    setError(null);
    emailVerifyMutation.mutate();
  }

  function refreshWechat() {
    setWechatMessage('正在通过 PicUp 后端创建微信登录二维码...');
    setNotice(null);
    setError(null);
    setWechatState(null);
    setWechatQrCodeUrl(null);
    wechatStartMutation.mutate();
  }

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto max-w-md">
        <Link
          className="mb-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700"
          href="/"
        >
          <ArrowLeft size={18} aria-hidden />
          返回工作台
        </Link>

        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="mb-5">
            <h1 className="text-2xl font-bold">登录 PicUp</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              支持邮箱验证码注册、密码登录和微信扫码登录。
            </p>
          </div>

          <div className="mb-4 grid grid-cols-3 rounded-lg border border-line bg-slate-50 p-1">
            <TabButton active={tab === 'email-register'} onClick={() => setTab('email-register')}>
              邮箱注册
            </TabButton>
            <TabButton active={tab === 'password-login'} onClick={() => setTab('password-login')}>
              密码登录
            </TabButton>
            <TabButton active={tab === 'wechat'} onClick={() => setTab('wechat')}>
              微信扫码
            </TabButton>
          </div>

          {tab === 'email-register' && (
            <div className="grid gap-4">
              {!challengeId ? (
                <form className="grid gap-4" onSubmit={submitEmailStart}>
                  <EmailPasswordFields
                    email={email}
                    password={password}
                    onEmailChange={setEmail}
                    onPasswordChange={setPassword}
                    passwordAutoComplete="new-password"
                  />
                  <button
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    disabled={!email.trim() || password.length < 8 || emailStartMutation.isPending}
                    type="submit"
                  >
                    {emailStartMutation.isPending ? (
                      <Loader2 className="animate-spin" size={20} aria-hidden />
                    ) : (
                      <UserPlus size={20} aria-hidden />
                    )}
                    发送验证码
                  </button>
                </form>
              ) : (
                <form className="grid gap-4" onSubmit={submitEmailVerify}>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold">邮箱验证码</span>
                    <input
                      className="min-h-11 rounded-lg border border-line bg-white px-3 text-base"
                      inputMode="numeric"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="6 位验证码"
                      required
                    />
                  </label>
                  <button
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    disabled={code.trim().length < 4 || emailVerifyMutation.isPending}
                    type="submit"
                  >
                    {emailVerifyMutation.isPending ? (
                      <Loader2 className="animate-spin" size={20} aria-hidden />
                    ) : (
                      <MailCheck size={20} aria-hidden />
                    )}
                    完成注册并登录
                  </button>
                  <button
                    className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700"
                    type="button"
                    onClick={() => {
                      setChallengeId(null);
                      setNotice(null);
                    }}
                  >
                    修改邮箱
                  </button>
                </form>
              )}
            </div>
          )}

          {tab === 'password-login' && (
            <form className="grid gap-4" onSubmit={submitPassword}>
              <EmailPasswordFields
                email={email}
                password={password}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                passwordAutoComplete="current-password"
              />
              <button
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!email.trim() || password.length < 8 || passwordLoginMutation.isPending}
                type="submit"
              >
                {passwordLoginMutation.isPending ? (
                  <Loader2 className="animate-spin" size={20} aria-hidden />
                ) : (
                  <LogIn size={20} aria-hidden />
                )}
                登录
              </button>
            </form>
          )}

          {tab === 'wechat' && (
            <div className="grid gap-4">
              <div className="flex aspect-square items-center justify-center rounded-lg border border-line bg-slate-50 p-5">
                {wechatStartMutation.isPending ? (
                  <Loader2 className="animate-spin text-teal-700" size={36} aria-hidden />
                ) : wechatQrCodeUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={wechatQrCodeUrl}
                    alt="微信扫码登录二维码"
                    className="max-h-full max-w-full rounded-md object-contain"
                  />
                ) : (
                  <QrCode className="text-teal-700" size={52} aria-hidden />
                )}
              </div>
              <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-center text-sm leading-6 text-teal-800">
                {wechatMessage || (wechatQrCodeUrl ? '等待微信扫码...' : '正在创建二维码...')}
              </div>
              {wechatQrCodeUrl && (
                <a className="break-all text-xs text-muted hover:text-teal-700" href={wechatQrCodeUrl} target="_blank" rel="noreferrer">
                  打开二维码链接
                </a>
              )}
              <button
                className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={refreshWechat}
                disabled={wechatStartMutation.isPending}
              >
                刷新二维码
              </button>
            </div>
          )}

          {notice && <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">{notice}</div>}
          {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </section>
      </div>
    </main>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={`min-h-10 rounded-md text-sm font-semibold transition-colors ${
        active ? 'bg-white text-teal-700 shadow-sm' : 'text-muted hover:text-ink'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function EmailPasswordFields({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  passwordAutoComplete
}: {
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  passwordAutoComplete: string;
}) {
  return (
    <>
      <label className="grid gap-2">
        <span className="text-sm font-semibold">邮箱</span>
        <input
          className="min-h-11 rounded-lg border border-line bg-white px-3 text-base"
          type="email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          autoComplete="email"
          required
        />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-semibold">密码</span>
        <input
          className="min-h-11 rounded-lg border border-line bg-white px-3 text-base"
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          autoComplete={passwordAutoComplete}
          minLength={8}
          required
        />
      </label>
    </>
  );
}
