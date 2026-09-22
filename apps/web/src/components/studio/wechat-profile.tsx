'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useQueryClient } from '@tanstack/react-query';
import { authorizeWechatProfile, syncWechatProfile } from '@/lib/api';

export function WechatProfile({ userId, onSynced }: { userId: string; onSynced: () => void }) {
  const client = useQueryClient();
  const [grant, setGrant] = useState<Awaited<ReturnType<typeof authorizeWechatProfile>> | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const result = await syncWechatProfile();
    if (result.status === 'succeeded') {
      setGrant(null); setMessage('微信头像和昵称已同步');
      await client.invalidateQueries({ queryKey: ['me'] });
      onSynced();
    }
    return result.status;
  }, [client, onSynced]);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [userId, refresh]);
  useEffect(() => {
    if (!grant) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed) return;
      if (Date.now() >= Date.parse(grant.expires_at)) {
        setGrant(null); setMessage('授权二维码已过期，请重新获取'); return;
      }
      try {
        const status = await refresh();
        if (disposed || status === 'succeeded') return;
        if (['declined', 'failed', 'expired', 'idle'].includes(status)) {
          setGrant(null); setMessage('授权未完成，可重新同步'); return;
        }
      } catch { if (!disposed) setMessage('连接暂时中断，正在重试'); }
      if (!disposed) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [grant, refresh]);
  async function start() {
    const current = ++generation.current;
    setBusy(true); setMessage(''); setQr('');
    try {
      const next = await authorizeWechatProfile();
      if (current !== generation.current) return;
      if (/MicroMessenger/i.test(navigator.userAgent)) { window.location.assign(next.authorization_url); return; }
      const image = await QRCode.toDataURL(next.authorization_url, { width: 240, margin: 2 });
      if (current !== generation.current) return;
      setQr(image); setGrant(next);
    } catch (error) { setMessage(error instanceof Error ? error.message : '暂时无法发起授权'); }
    finally { setBusy(false); }
  }
  return <div className="wechat-profile-sync">
    <div className="account-profile-heading"><h3>账户资料</h3><span className="wechat-sync-tool">
      <button type="button" className="wechat-sync-trigger" aria-label={busy ? '正在获取授权' : '同步微信头像和昵称'} aria-busy={busy} disabled={busy} onClick={start}><RefreshCw size={15} /></button>
      <span className="wechat-sync-tooltip" role="tooltip">{busy ? '正在获取授权' : '同步微信头像和昵称'}</span>
    </span></div>
    {grant && <div className="wechat-profile-authorization" style={{ marginTop: 16, maxWidth: '100%', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><strong>微信资料授权</strong><button type="button" title="取消同步" aria-label="取消同步" onClick={() => { generation.current++; setGrant(null); }}><X size={18} /></button></div>
      {qr && <img src={qr} alt="微信资料授权二维码" width={240} height={240} style={{ maxWidth: '100%', height: 'auto', margin: '12px auto' }} />}
      <p role="status">等待微信授权</p>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
