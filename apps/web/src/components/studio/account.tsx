'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Save } from 'lucide-react';
import QRCode from 'qrcode';
import type { AuthMeResponse, PaymentOrderResponse, ModelsResponse } from '@picup/shared';
import { createRechargeOrder, getAccountActivity, getPaymentOrder, logout, updateProfile } from '@/lib/api';
import { PreferenceFields, usePreferences } from './preferences';
import { WechatProfile } from './wechat-profile';
import { ProfileAvatar } from './profile-avatar';

export function Account({ me, onPayment: _onPayment, onLogout, onLogin, onRecharge, models }: { me?: AuthMeResponse; onPayment: (order: PaymentOrderResponse) => void; onLogout: () => void; onLogin: () => void; onRecharge: () => void; models?: ModelsResponse }) {
  const client = useQueryClient();
  const { preferences, save } = usePreferences(me?.user.id);
  const [name, setName] = useState(me?.user.displayName ?? '');
  const [email, setEmail] = useState(me?.user.email ?? '');
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState(false);
  const guest = !me || me.user.isGuest;
  const synced = useCallback(() => { setSaved(true); }, []);
  useEffect(() => { setName(me?.user.displayName ?? ''); }, [me?.user.displayName]);
  const profile = useMutation({ mutationFn: updateProfile, onSuccess: async () => {
    setPassword(''); setSaved(true); await client.invalidateQueries({ queryKey: ['me'] });
  } });
  const signOut = useMutation({ mutationFn: logout, onSuccess: onLogout });
  return <div className="account-content">
    <div className="account-identity"><span className="account-avatar"><ProfileAvatar url={me?.user.avatarUrl} /></span><div><div className="account-name-row"><h3>{me?.user.displayName || me?.user.email || (guest ? '访客' : `注册用户 ${me?.user.id.slice(0, 8)}`)}</h3>{!guest && me.user.wechatBound && <WechatProfile userId={me.user.id} onSynced={synced} />}</div><p>{guest ? '未登录' : me?.user.email || '微信账户'}</p>{!guest && <button className="account-credit" onClick={onRecharge}>{me.credits.balance} 积分 · 充值</button>}</div></div>
    {guest ? <button className="studio-primary" onClick={onLogin}>登录 / 注册</button> : <>
      <PreferenceFields value={preferences} onChange={patch => save.mutate(patch)} pending={save.isPending} error={save.error?.message} models={models} />
      <section className="account-section"><h3>账户资料</h3><form className="studio-form" onSubmit={event => { event.preventDefault(); setSaved(false); profile.mutate({ displayName: name, email, ...(password ? { password } : {}) }); }}>
        <label>昵称<input value={name} onChange={event => setName(event.target.value)} autoComplete="nickname" /></label>
        <label>邮箱<input type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>
        <label>新密码<input type="password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" placeholder="留空则保持不变" /></label>
        {profile.error && <p role="alert" className="studio-error">{profile.error.message}</p>}
        {saved && <p role="status" className="text-teal-700">账户已更新</p>}
        <button className="studio-secondary" type="submit" disabled={profile.isPending}><Save size={16} />保存资料</button>
      </form></section>
      {me.user.role === 'admin' && <Link className="studio-secondary" href="/admin">管理后台</Link>}
      <button className="studio-secondary" disabled={signOut.isPending} onClick={() => signOut.mutate()}><LogOut size={16} />退出登录</button>
      {signOut.error && <p role="alert" className="studio-error">{signOut.error.message}</p>}
    </>}
    <footer className="account-links"><Link href="/terms">用户协议</Link><Link href="/privacy">隐私政策</Link><a href="https://contentos.ai-mendao.xyz/" target="_blank" rel="noreferrer">图文创作</a></footer>
  </div>;
}

export function CreditActivity({ me, onRecharge, onPayment: _onPayment }: { me?: AuthMeResponse; onRecharge: () => void; onPayment: (order: PaymentOrderResponse) => void }) {
  const activity = useQuery({ queryKey: ['activity', me?.user.id], queryFn: getAccountActivity, enabled: Boolean(me && !me.user.isGuest) });
  const [showAll, setShowAll] = useState(false);
  const entries = activity.data?.entries ?? [];
  const visibleEntries = showAll ? entries : entries.slice(0, 5);
  return <div className="credit-popover">
    <div className="credit-popover-balance"><div><span>当前积分</span><strong>{me?.credits.balance ?? 0}</strong></div><button className="credit-recharge-cta" onClick={onRecharge}><span>充值积分</span><small>选择套餐</small></button></div>
    <div className="credit-popover-heading"><strong>最近交易</strong>{entries.length > 5 && <button className="studio-text-button" onClick={() => setShowAll(value => !value)}>{showAll ? '收起记录' : `查看全部 ${entries.length} 条`}</button>}</div>
    {activity.isPending && <p className="studio-empty">加载中</p>}
    <div className="credit-activity-list">{visibleEntries.map(entry => <div className="account-entry" key={entry.key}><span>{({ credits: '生成扣款', free: '免费生成', refund: '失败退回', recharge: '充值', single: '单次付费' } as Record<string, string>)[entry.kind] ?? entry.kind}<small>{new Date(entry.createdAt).toLocaleString()}</small></span><strong>{entry.delta > 0 ? '+' : ''}{entry.delta} 积分</strong></div>)}</div>
    {!activity.isPending && !entries.length && <p className="text-muted">暂无交易记录</p>}
  </div>;
}

export function Payment({ order, onPaid }: { order: PaymentOrderResponse; onPaid: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const handled = useRef(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => { const update = () => setVisible(!document.hidden); update(); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  const query = useQuery({ queryKey: ['payment-order', order.id], queryFn: () => getPaymentOrder(order.id), enabled: visible,
    retry: false, refetchIntervalInBackground: false,
    refetchInterval: query => ['paid', 'failed', 'closed', 'expired'].includes(query.state.data?.status ?? order.status) || query.state.errorUpdateCount >= 5 ? false : 3000 });
  const current = query.data ?? order;
  useEffect(() => {
    let active = true;
    setQr(null);
    const content = current.checkoutUrl ?? current.codeUrl;
    if (content) void QRCode.toDataURL(content, { width: 440, margin: 4 })
      .then(url => { if (active) setQr(url); }).catch(() => { if (active) setQr(null); });
    return () => { active = false; };
  }, [current.codeUrl, current.checkoutUrl]);
  useEffect(() => { if (current.status === 'paid' && !handled.current) { handled.current = true; onPaid(); } }, [current.status, onPaid]);
  return <div className="payment-content"><p>{current.orderType === 'credit_recharge' ? '积分充值' : '单次生成'}</p><strong className="payment-amount">¥{(current.amountCents / 100).toFixed(2)}</strong>
    {qr && current.status === 'pending' && <img src={qr} alt="微信支付二维码" width={220} height={220} />}
    <p role="status">{current.status === 'paid' ? '支付成功' : current.status === 'pending' ? '等待微信支付' : '订单已结束'}</p>
    {query.error && <p role="alert" className="studio-error">{query.errorUpdateCount >= 5 ? '连接暂时中断，请关闭后从账户中的待支付订单重新打开。' : '支付结果确认中，请稍候。'}</p>}
    {current.checkoutUrl && current.status === 'pending' && <a className="studio-primary" href={current.checkoutUrl}>前往收银台</a>}
    {current.status === 'pending' && <button className="studio-secondary" disabled={query.isFetching} onClick={() => query.refetch()}>刷新支付状态</button>}
  </div>;
}

export function Recharge({ me, onPayment }: { me?: AuthMeResponse; onPayment: (order: PaymentOrderResponse) => void }) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const recharge = useMutation({ mutationFn: createRechargeOrder, onSuccess: order => {
    onPayment(order);
    if (order.checkoutUrl && /MicroMessenger/i.test(navigator.userAgent)) window.location.assign(order.checkoutUrl);
  } });
  const selectedPlan = me?.credits.rechargePlans.find(plan => plan.id === selectedPlanId);
  return <div className="recharge-content"><div className="recharge-balance"><span>当前余额</span><strong>{me?.credits.balance ?? 0}<small>积分</small></strong></div><p className="recharge-hint">选择积分套餐，使用微信安全支付</p>
    <div className="recharge-options">{me?.credits.rechargePlans.map((plan, index) => { const minImages = Math.ceil(plan.credits / 2); return <button type="button" className={`recharge-plan ${index === 1 ? 'is-recommended' : ''} ${selectedPlanId === plan.id ? 'is-selected' : ''}`} key={plan.id} disabled={recharge.isPending} aria-pressed={selectedPlanId === plan.id} onClick={() => setSelectedPlanId(plan.id)}><span className="recharge-plan-top">{index === 1 && <em>更划算</em>}<strong>{plan.credits}</strong> 积分</span><span className="recharge-plan-price">¥{(plan.amountCents / 100).toFixed(2)}</span><span className="recharge-plan-estimate">约可生成 {minImages}–{plan.credits} 张图片</span><span className="recharge-plan-action">{selectedPlanId === plan.id ? '已选择' : '选择套餐'}</span></button>; })}</div>
    <div className="recharge-confirm"><span>{selectedPlan ? `已选择 ${selectedPlan.credits} 积分 · ¥${(selectedPlan.amountCents / 100).toFixed(2)}` : '请选择一个充值套餐'}</span><button className="studio-primary" disabled={!selectedPlan || recharge.isPending} onClick={() => selectedPlan && recharge.mutate({ planId: selectedPlan.id })}>{recharge.isPending ? '创建订单…' : '确认充值'}</button></div>
    {recharge.isPending && <p role="status">正在创建订单</p>}{recharge.error && <p className="studio-error" role="alert">{recharge.error.message}</p>}
  </div>;
}
