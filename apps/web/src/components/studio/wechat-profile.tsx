'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { useQueryClient } from '@tanstack/react-query';
import { authorizeWechatProfile, syncWechatProfile } from '@/lib/api';
import { Dialog } from './dialog';

export function WechatProfile({ userId, onSynced }: { userId: string; onSynced: () => void }) {
  const client = useQueryClient();
  const [grant, setGrant] = useState<Awaited<ReturnType<typeof authorizeWechatProfile>> | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const close = () => { generation.current++; setOpen(false); setGrant(null); setQr(''); setBusy(false); };
  useEffect(() => () => { generation.current++; }, []);
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
    setOpen(true); setBusy(true); setMessage(''); setQr(''); setGrant(null);
    try {
      const next = await authorizeWechatProfile();
      if (current !== generation.current) return;
      if (/MicroMessenger/i.test(navigator.userAgent)) { window.location.assign(next.authorization_url); return; }
      const image = await QRCode.toDataURL(next.authorization_url, { width: 240, margin: 2 });
      if (current !== generation.current) return;
      setQr(image); setGrant(next);
    } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : '暂时无法发起授权'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <div className="wechat-profile-sync">
    <span className="wechat-sync-tool">
      <button type="button" className="wechat-sync-trigger" aria-label={busy ? '正在获取授权' : '同步微信头像和昵称'} aria-busy={busy} disabled={busy} onClick={start}><RefreshCw size={15} /></button>
      <span className="wechat-sync-tooltip" role="tooltip">{busy ? '正在获取授权' : '同步微信头像和昵称'}</span>
    </span>
    {open && <Dialog title="同步微信头像和昵称" onClose={close}><div className="wechat-profile-authorization">
      {busy ? <div className="wechat-profile-loading"><RefreshCw size={24} /><p role="status">正在获取二维码</p></div> : grant && qr ? <><img src={qr} alt="微信资料授权二维码" width={240} height={240} /><p role="status">请使用微信扫码授权</p></> : null}
      {message && <p role="status">{message}</p>}
      {!busy && !grant && (message === '微信头像和昵称已同步' ? <button type="button" className="studio-primary" onClick={close}>完成</button> : <button type="button" className="studio-secondary" onClick={start}><RefreshCw size={16} />重新获取二维码</button>)}
    </div></Dialog>}
  </div>;
}
