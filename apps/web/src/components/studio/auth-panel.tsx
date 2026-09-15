'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { getWechatAuthStatus, login, startEmailAuth, startWechatAuth, verifyEmailAuth } from '@/lib/api';

export function AuthPanel({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [tab, setTab] = useState<'wechat' | 'login' | 'register'>('wechat');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [code, setCode] = useState(''); const [accepted, setAccepted] = useState(false);
  const [loaded, setLoaded] = useState(false); const [imageError, setImageError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const completed = useRef(false);
  const finish = useMutation({ mutationFn: onSuccess });
  const start = useQuery({ queryKey: ['wechat-login-session'], queryFn: startWechatAuth, enabled: tab === 'wechat', retry: false, staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const expired = Boolean(start.data && new Date(start.data.expiresAt).getTime() <= now);
  const status = useQuery({ queryKey: ['wechat-login-status', start.data?.state], queryFn: () => getWechatAuthStatus(start.data!.state), enabled: tab === 'wechat' && Boolean(start.data) && !expired && !start.isFetching && !completed.current,
    retry: false, refetchOnWindowFocus: false, refetchInterval: query => ['confirmed', 'consumed', 'expired', 'failed'].includes(query.state.data?.status ?? '') ? false : 2000 });
  useEffect(() => { if (tab !== 'wechat') return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [tab]);
  useEffect(() => { setLoaded(false); setImageError(false); }, [start.data?.state]);
  useEffect(() => {
    if (status.data?.status === 'confirmed' && !completed.current) { completed.current = true; finish.mutate(); }
  }, [status.data?.status, finish]);
  const passwordLogin = useMutation({ mutationFn: () => login({ email, password }), onSuccess: () => finish.mutate() });
  const registration = useMutation({ mutationFn: () => startEmailAuth({ email, password, mode: 'register', termsAccepted: accepted }) });
  const verify = useMutation({ mutationFn: () => verifyEmailAuth({ challengeId: registration.data!.challengeId, code }), onSuccess: () => finish.mutate() });
  const terminal = expired || ['expired', 'consumed', 'failed'].includes(status.data?.status ?? '');
  const confirmed = status.data?.status === 'confirmed';
  const unavailable = start.isError || imageError;
  const busy = passwordLogin.isPending || registration.isPending || verify.isPending || finish.isPending;
  const error = finish.error || (tab === 'login' ? passwordLogin.error : tab === 'register' ? verify.error || registration.error : null);
  return <div className="auth-modal-content">
    <div className="studio-segments auth-modes" aria-label="登录方式">
      <button disabled={busy} aria-pressed={tab === 'wechat'} onClick={() => setTab('wechat')}>微信扫码</button>
      <button disabled={busy} aria-pressed={tab === 'login'} onClick={() => setTab('login')}>密码登录</button>
      <button disabled={busy} aria-pressed={tab === 'register'} onClick={() => setTab('register')}>邮箱注册</button>
    </div>
    {tab === 'wechat' ? <div className="wechat-login">
      <div className="wechat-qr-stage" aria-busy={start.isFetching || Boolean(start.data && !loaded && !imageError)}>
        {start.data && !start.isFetching && !unavailable && <img key={start.data.state} src={start.data.qrCodeUrl} width={220} height={220} alt="微信扫码登录二维码" onLoad={() => setLoaded(true)} onError={() => setImageError(true)} />}
        {!confirmed && (start.isFetching || (!loaded && !unavailable && !terminal)) && <div className="qr-state"><Loader2 size={28} className="animate-spin" /><span>正在加载二维码</span></div>}
        {(terminal || unavailable) && <div className="qr-state"><QrCode size={30} /><span>{unavailable ? '二维码加载失败' : status.data?.status === 'consumed' ? '二维码已使用' : status.data?.status === 'failed' ? '登录未完成' : '二维码已过期'}</span><button className="studio-secondary" disabled={start.isFetching} onClick={() => { setLoaded(false); setImageError(false); void start.refetch(); }}><RefreshCw size={16} />重新获取</button></div>}
        {confirmed && <div className="qr-state qr-success"><CheckCircle2 size={40} /><span>确认成功</span></div>}
      </div>
      <p className="wechat-login-status" role="status">{confirmed ? finish.isError ? '账户加载失败，请重试' : '正在登录' : unavailable ? '可重试或使用邮箱登录' : terminal ? '请重新获取二维码' : loaded ? <><span className="waiting-dot" />使用微信扫一扫，确认登录</> : '正在连接微信登录'}</p>
      {!terminal && !unavailable && !confirmed && <button className="studio-text-button" disabled={start.isFetching} onClick={() => { setLoaded(false); void start.refetch(); }}><RefreshCw size={14} />刷新二维码</button>}
      {status.isError && !terminal && <p className="studio-error" role="alert">连接暂时中断，正在重试</p>}
    </div> : <form className="studio-form auth-email-form" onSubmit={event => { event.preventDefault(); if (busy) return; if (tab === 'login') passwordLogin.mutate(); else if (registration.data) verify.mutate(); else registration.mutate(); }}>
      {tab === 'register' && registration.data ? <><p className="auth-sent">验证码已发送至 {registration.data.email}</p><label>邮箱验证码<input required autoComplete="one-time-code" inputMode="numeric" value={code} onChange={event => setCode(event.target.value)} minLength={4} maxLength={8} /></label><button type="button" disabled={busy} className="studio-text-button" onClick={() => { registration.reset(); verify.reset(); setCode(''); }}>修改邮箱 / 重新发送</button></> : <>
        <label>邮箱<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>密码<input required type="password" minLength={8} autoComplete={tab === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {tab === 'register' && <label className="auth-consent"><input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>我已阅读并同意 <a href="/terms" target="_blank" rel="noreferrer">用户协议</a> 和 <a href="/privacy" target="_blank" rel="noreferrer">隐私政策</a></span></label>}
      </>}
      <button className="studio-primary" type="submit" disabled={busy || (tab === 'register' && !registration.data && !accepted)}>{busy && <Loader2 size={16} className="animate-spin" />}{tab === 'login' ? '登录' : registration.data ? '完成注册并登录' : '发送验证码'}</button>
    </form>}
    {error && <p className="studio-error" role="alert">{error.message}</p>}
    {finish.isError && <button className="studio-secondary" onClick={() => finish.mutate()}>重新加载账户</button>}
  </div>;
}
