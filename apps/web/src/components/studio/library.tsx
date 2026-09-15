'use client';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AtSign, Archive, ArchiveRestore, Check, Download, ImagePlus, MoreHorizontal, Pencil, Plus, Search, Trash2, MessageSquare } from 'lucide-react';
import type { StudioSubject } from '@picup/shared';
import { deleteStudioConversation, listStudioAssets, listStudioConversations, updateStudioAsset, updateStudioConversation, uploadImage, type StudioAsset } from '@/lib/api';
import { useNotifications } from '@/components/notification-provider';
import { Dialog } from './dialog';
import { JobStatus } from './canvas';
import { SubjectDialog } from './subject-dialog';

export function Conversations({ onOpen, onDeleted }: { onOpen: (id: string) => void; onDeleted?: (rootJobId: string) => void }) {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const notices = useNotifications();
  const client = useQueryClient();
  const query = useInfiniteQuery({ queryKey: ['conversations', q, archived], initialPageParam: 0, staleTime: 30_000, gcTime: 5 * 60_000, queryFn: ({ pageParam }) => listStudioConversations(q, pageParam, archived), getNextPageParam: page => page.next ?? undefined });
  const change = useMutation({ mutationFn: ({ rootJobId, action }: { rootJobId: string; action: 'archive' | 'restore' }) => updateStudioConversation(rootJobId, action), onSuccess: () => { void client.invalidateQueries({ queryKey: ['conversations'] }); }, onError: error => notices.error('操作失败', error.message) });
  const remove = useMutation({ mutationFn: deleteStudioConversation, onSuccess: (_, rootJobId) => { void client.invalidateQueries({ queryKey: ['conversations'] }); onDeleted?.(rootJobId); }, onError: error => notices.error('删除失败', error.message) });
  const items = query.data?.pages.flatMap(page => page.items) ?? [];
  const confirmRemove = (rootJobId: string) => { if (pendingDelete === rootJobId) { remove.mutate(rootJobId); setPendingDelete(null); } else setPendingDelete(rootJobId); };
  const toggleArchive = (rootJobId: string) => {
    if (pendingArchive === rootJobId) {
      change.mutate({ rootJobId, action: archived ? 'restore' : 'archive' });
      setPendingArchive(null);
    } else {
      setPendingArchive(rootJobId);
    }
  };
  return <div className="history-content"><div className="library-toolbar"><label className="search-field"><Search size={18} /><input aria-label="搜索对话" placeholder="搜索对话" value={q} onChange={e => setQ(e.target.value)} /></label><div className="studio-segments history-segments" role="tablist" aria-label="对话状态"><button type="button" role="tab" aria-selected={!archived} onClick={() => setArchived(false)}>进行中</button><button type="button" role="tab" aria-selected={archived} onClick={() => setArchived(true)}>已归档</button></div></div>
    <div className="history-list">{items.map(item => <article className="conversation-entry" key={item.id}><button className="conversation-open" onClick={() => onOpen(item.jobId)}><MessageSquare size={20} /><span><strong>{item.title}</strong><small>{item.count} 轮 · {new Date(item.updatedAt).toLocaleDateString()}</small><JobStatus status={item.status} /></span></button><div className="conversation-actions"><button className={`studio-icon ${pendingArchive === item.id ? 'is-confirm' : ''}`} title={pendingArchive === item.id ? '再次点击确认' : archived ? '恢复对话' : '归档对话'} aria-label={pendingArchive === item.id ? '再次点击确认' : archived ? '恢复对话' : '归档对话'} disabled={change.isPending || remove.isPending} onClick={() => toggleArchive(item.id)}>{pendingArchive === item.id ? <Check size={17} /> : archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}</button><button className={`studio-icon ${pendingArchive === item.id ? 'is-danger-confirm' : 'is-danger'}`} title={pendingArchive === item.id ? '再次点击确认删除' : '删除对话'} aria-label={pendingArchive === item.id ? '再次点击确认删除' : '删除对话'} disabled={change.isPending || remove.isPending} onClick={() => void confirmRemove(item.id)}><Trash2 size={17} /></button></div></article>)}
      {query.isPending && <p className="studio-empty">正在加载对话</p>}{query.isError && <button className="studio-secondary" onClick={() => query.refetch()}>加载失败，重试</button>}
      {!query.isPending && items.length === 0 && <p className="studio-empty">{q ? '没有匹配的对话' : archived ? '还没有归档的对话' : '还没有对话'}</p>}
      {query.hasNextPage && <button className="studio-secondary" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>加载更多</button>}
    </div></div>;
}

export function AssetLibrary({ onUse: _onUse, onPreview, onSubject }: { onUse: (asset: StudioAsset) => Promise<void>; onPreview: (asset: StudioAsset, collection: StudioAsset[]) => void; onSubject: (subject: StudioSubject) => void }) {
  const [q, setQ] = useState(''); const [kind, setKind] = useState('');
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [editing, setEditing] = useState<StudioAsset | null>(null); const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null); const notices = useNotifications(); const client = useQueryClient();
  const query = useInfiniteQuery({ queryKey: ['assets', q, kind], initialPageParam: 0, queryFn: ({ pageParam }) => listStudioAssets(q, kind, pageParam), getNextPageParam: page => page.next ?? undefined });
  const change = useMutation({ mutationFn: ({ key, ...data }: { key: string; title?: string; hidden?: boolean }) => updateStudioAsset(key, data), onSuccess: () => { setEditing(null); void client.invalidateQueries({ queryKey: ['assets'] }); void client.invalidateQueries({ queryKey: ['subjects'] }); }, onError: e => notices.error('操作失败', e.message) });
  const add = useMutation({ mutationFn: async (file: File) => {
    const uploaded = await uploadImage(file);
    await updateStudioAsset(`file:${uploaded.id}`, { hidden: false });
    return uploaded;
  }, onSuccess: () => { void client.invalidateQueries({ queryKey: ['assets'] }); }, onError: e => notices.error('上传失败', e.message) });
  const toggleSelected = (key: string) => setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const finishSelection = () => setSelected(new Set());
  const removeAsset = async (asset: StudioAsset) => {
    if (!await notices.confirm({ title: '从图库移除图片？', message: '图片将从图库中隐藏，对话中的图片仍会保留。', confirmText: '移除', tone: 'danger' })) return;
    change.mutate({ key: asset.key, hidden: true });
  };
  const removeSelected = async () => {
    const keys = [...selected];
    if (!keys.length) return;
    if (!await notices.confirm({ title: `删除 ${keys.length} 张图片？`, message: '删除后将从图库中隐藏，对话中的图片仍会保留。', confirmText: '批量删除', tone: 'danger' })) return;
    const result = await Promise.allSettled(keys.map(key => updateStudioAsset(key, { hidden: true })));
    if (result.some(item => item.status === 'rejected')) notices.error('部分图片删除失败', '请稍后重试');
    finishSelection(); void client.invalidateQueries({ queryKey: ['assets'] }); void client.invalidateQueries({ queryKey: ['subjects'] });
  };
  const assets = query.data?.pages.flatMap(page => page.items) ?? [];
  return <div><div className="library-toolbar"><label className="search-field"><Search size={18} /><input aria-label="搜索图片" placeholder="搜索图片名称" value={q} onChange={e => setQ(e.target.value)} /></label><button className="studio-icon" title="上传图片" aria-label="上传图片" disabled={add.isPending} onClick={() => fileInput.current?.click()}><ImagePlus size={20} /></button>
    <button className="studio-icon" title="创建主体" aria-label="创建主体" onClick={() => setCreatingSubject(true)}><Plus size={20} /></button>
    <select aria-label="图片来源" value={kind} onChange={e => setKind(e.target.value)}><option value="">全部图片</option><option value="generated">生成图片</option><option value="upload">上传图片</option><option value="subject">主体</option></select></div>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { if (e.target.files?.[0]) add.mutate(e.target.files[0]); e.target.value = ''; }} />
    {query.isPending && <p className="studio-empty">正在加载图片</p>}{query.isError && <button className="studio-secondary" onClick={() => query.refetch()}>加载失败，重试</button>}
    {query.data?.pages[0].items.length === 0 && <p className="studio-empty">{q || kind ? '没有匹配的图片' : '图库为空'}</p>}
    {selected.size > 0 && <div className="asset-selection-bar"><span>已选择 {selected.size} 张</span><button className="studio-secondary" onClick={removeSelected}><Trash2 size={16} />删除</button><button className="studio-icon" onClick={finishSelection} title="退出多选" aria-label="退出多选"><Check size={18} /></button></div>}
    <div className="asset-grid">{assets.map(asset => <article className={`asset-item ${selected.has(asset.key) ? 'is-selected' : ''}`} key={asset.key}
      onPointerDown={() => { longPress.current = setTimeout(() => { setSelected(current => { const next = new Set(current); next.add(asset.key); return next; }); }, 520); }}
      onPointerUp={() => { if (longPress.current) clearTimeout(longPress.current); longPress.current = null; }}
      onPointerCancel={() => { if (longPress.current) clearTimeout(longPress.current); longPress.current = null; }}>
      <div className="asset-media"><button className="asset-image" onClick={() => selected.size ? toggleSelected(asset.key) : onPreview(asset, assets)} title={selected.size ? '选择图片' : '预览图片'}><img src={asset.url} alt={asset.title} loading="lazy" />{selected.has(asset.key) && <span className="asset-selection-mark"><Check size={15} /></span>}</button><div className={`asset-actions ${selected.size ? 'is-multi-select-hidden' : ''}`} aria-label={`图片操作：${asset.title}`}>
        <a className="studio-icon" href={asset.jobId ? `/api/image/jobs/${asset.jobId}/download/${asset.index}` : asset.url} download title="下载图片" aria-label="下载图片"><Download size={17} /></a>
        {asset.subjectId && asset.fileId && <button className="studio-icon" title="引用主体" aria-label={`引用主体：${asset.title}`} onClick={() => onSubject({ id: asset.subjectId!, name: asset.title, description: '', createdAt: asset.createdAt, file: { id: asset.fileId!, url: asset.url, mimeType: 'image/png', size: 0, createdAt: asset.createdAt } })}><AtSign size={17} /></button>}
        <button className="studio-icon is-danger" title="从图库移除" aria-label={`从图库移除：${asset.title}`} disabled={change.isPending} onClick={() => void removeAsset(asset)}><Trash2 size={17} /></button>
        <details className="asset-more"><summary className="studio-icon" title="更多操作" aria-label="更多操作"><MoreHorizontal size={18} /></summary><div className="asset-more-menu"><button onClick={() => { setEditing(asset); setTitle(asset.title.slice(0, 120)); }}><Pencil size={16} />重命名</button></div></details>
      </div></div>{asset.kind === 'subject' && <div className="subject-asset-label">{asset.title}</div>}
    </article>)}</div>
    {query.hasNextPage && <button className="studio-secondary history-more" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>加载更多</button>}
    {editing && <Dialog title="重命名图片" onClose={() => setEditing(null)}><form className="studio-form settings-content" onSubmit={e => { e.preventDefault(); if (title.trim()) change.mutate({ key: editing.key, title: title.trim() }); }}><label>图片名称<input autoFocus maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} /></label><button className="studio-primary" disabled={change.isPending || !title.trim()}>保存</button></form></Dialog>}
    {creatingSubject && <SubjectDialog files={[]} onClose={() => setCreatingSubject(false)} onSaved={() => { setCreatingSubject(false); setKind('subject'); }} />}
  </div>;
}
