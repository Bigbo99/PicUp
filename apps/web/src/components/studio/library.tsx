'use client';

import { thumbnailUrl } from '@/lib/thumbnail';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AtSign, Archive, ArchiveRestore, Check, Download, ImagePlus, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, MessageSquare } from 'lucide-react';
import type { StudioSubject } from '@picup/shared';
import { deleteStudioConversation, listStudioAssets, listStudioConversations, updateStudioAsset, updateStudioConversation, uploadImage, type StudioAsset } from '@/lib/api';
import { useNotifications } from '@/components/notification-provider';
import { Dialog } from './dialog';
import { JobStatus } from './canvas';
import { SubjectDialog } from './subject-dialog';
import { downloadAssets } from './download-assets';

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
  const cancelConfirmation = () => { setPendingDelete(null); setPendingArchive(null); };
  const confirmRemove = (rootJobId: string) => {
    if (change.isPending || remove.isPending) return;
    setPendingArchive(null);
    if (pendingDelete === rootJobId) { remove.mutate(rootJobId); setPendingDelete(null); }
    else setPendingDelete(rootJobId);
  };
  const toggleArchive = (rootJobId: string) => {
    if (change.isPending || remove.isPending) return;
    setPendingDelete(null);
    if (pendingArchive === rootJobId) {
      change.mutate({ rootJobId, action: archived ? 'restore' : 'archive' });
      setPendingArchive(null);
    } else {
      setPendingArchive(rootJobId);
    }
  };
  return <div className="history-content"><div className="library-toolbar"><label className="search-field"><Search size={18} /><input aria-label="搜索对话" placeholder="搜索对话" value={q} onChange={e => setQ(e.target.value)} /></label><div className="studio-segments history-segments" role="tablist" aria-label="对话状态"><button type="button" role="tab" aria-selected={!archived} onClick={() => setArchived(false)}>进行中</button><button type="button" role="tab" aria-selected={archived} onClick={() => setArchived(true)}>已归档</button></div></div>
    <div className="history-list">{items.map(item => {
      const deleting = remove.isPending && remove.variables === item.id;
      const archiving = change.isPending && change.variables?.rootJobId === item.id;
      const deleteLabel = deleting ? '正在删除对话' : pendingDelete === item.id ? '再次点击确认删除' : '删除对话';
      const archiveLabel = archiving ? '正在处理对话' : pendingArchive === item.id ? archived ? '再次点击确认恢复' : '再次点击确认归档' : archived ? '恢复对话' : '归档对话';
      return <article className="conversation-entry" key={item.id}>
        <button className="conversation-open" onClick={() => onOpen(item.jobId)}><MessageSquare size={20} /><span><strong>{item.title}</strong><small>{item.count} 轮 · {new Date(item.updatedAt).toLocaleDateString()}</small><JobStatus status={item.status} /></span></button>
        <div className="conversation-actions" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) cancelConfirmation(); }} onKeyDown={event => { if (event.key === 'Escape' && (pendingDelete || pendingArchive)) { event.preventDefault(); event.stopPropagation(); cancelConfirmation(); } }}>
          <button type="button" className={`studio-icon ${pendingArchive === item.id ? 'is-confirm' : ''}`} title={archiveLabel} aria-label={archiveLabel} aria-busy={archiving} disabled={change.isPending || remove.isPending} onClick={() => toggleArchive(item.id)}>{archiving ? <Loader2 size={17} className="animate-spin" /> : pendingArchive === item.id ? <Check size={17} /> : archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}</button>
          <button type="button" className={`studio-icon ${pendingDelete === item.id ? 'is-danger-confirm' : 'is-danger'}`} title={deleteLabel} aria-label={deleteLabel} aria-busy={deleting} disabled={change.isPending || remove.isPending} onClick={() => confirmRemove(item.id)}>{deleting ? <Loader2 size={17} className="animate-spin" /> : pendingDelete === item.id ? <Check size={17} /> : <Trash2 size={17} />}</button>
        </div>
      </article>;
    })}
      {query.isPending && <p className="studio-empty">正在加载对话</p>}{query.isError && <button className="studio-secondary" onClick={() => query.refetch()}>加载失败，重试</button>}
      {!query.isPending && items.length === 0 && <p className="studio-empty">{q ? '没有匹配的对话' : archived ? '还没有归档的对话' : '还没有对话'}</p>}
      {query.hasNextPage && <button className="studio-secondary" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>加载更多</button>}
    </div></div>;
}

export function AssetLibrary({ mobilePage = false, onUse: _onUse, onPreview, onSubject }: { mobilePage?: boolean; onUse: (asset: StudioAsset) => Promise<void>; onPreview: (asset: StudioAsset, collection: StudioAsset[]) => void; onSubject: (subject: StudioSubject) => void }) {
  const [q, setQ] = useState(''); const [kind, setKind] = useState('');
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [editing, setEditing] = useState<StudioAsset | null>(null); const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const downloadBusy = useRef(false);
  const selectionBusy = removing || downloading;
  const removeBusy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null); const notices = useNotifications(); const client = useQueryClient();
  const query = useInfiniteQuery({ queryKey: ['assets', q, kind], initialPageParam: 0, queryFn: ({ pageParam }) => listStudioAssets(q, kind, pageParam), getNextPageParam: page => page.next ?? undefined });
  const change = useMutation({ mutationFn: ({ key, ...data }: { key: string; title?: string; hidden?: boolean }) => updateStudioAsset(key, data), onSuccess: () => { setEditing(null); void client.invalidateQueries({ queryKey: ['assets'] }); void client.invalidateQueries({ queryKey: ['subjects'] }); }, onError: e => notices.error('操作失败', e.message) });
  const add = useMutation({ mutationFn: async (file: File) => {
    const uploaded = await uploadImage(file);
    await updateStudioAsset(`file:${uploaded.id}`, { hidden: false });
    return uploaded;
  }, onSuccess: () => { void client.invalidateQueries({ queryKey: ['assets'] }); }, onError: e => notices.error('上传失败', e.message) });
  const toggleSelected = (key: string) => {
    if (downloadBusy.current || removeBusy.current) return;
    setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };
  const finishSelection = () => { setSelected(new Set()); setSelecting(false); };
  const removeAsset = async (asset: StudioAsset) => {
    if (!await notices.confirm({ title: '从图库移除图片？', message: '图片将从图库中隐藏，对话中的图片仍会保留。', confirmText: '移除', tone: 'danger' })) return;
    change.mutate({ key: asset.key, hidden: true });
  };
  const removeSelected = async () => {
    const keys = [...selected];
    if (!keys.length || removeBusy.current || downloadBusy.current) return;
    removeBusy.current = true; setRemoving(true);
    try {
      if (!await notices.confirm({ title: `从图库移除这 ${keys.length} 张图片？`, message: '对话中的图片仍会保留。', confirmText: '移除', tone: 'danger' })) return;
      const result = await Promise.allSettled(keys.map(key => updateStudioAsset(key, { hidden: true })));
      const failed = keys.filter((_, index) => result[index].status === 'rejected');
      if (failed.length) {
        setSelected(new Set(failed));
        notices.error(`${failed.length} 张图片移除失败`, '已保留选中，请重试。');
      } else finishSelection();
      void client.invalidateQueries({ queryKey: ['assets'] }); void client.invalidateQueries({ queryKey: ['subjects'] });
    } finally { removeBusy.current = false; setRemoving(false); }
  };
  const assets = query.data?.pages.flatMap(page => page.items) ?? [];
  const downloadSelected = async () => {
    if (downloadBusy.current || removeBusy.current || !selected.size) return;
    downloadBusy.current = true; setDownloading(true);
    try {
      const items = assets.filter(asset => selected.has(asset.key));
      if (items.length !== selected.size) throw new Error('部分图片已不可用，请重新选择。');
      await downloadAssets(items);
    } catch (error) {
      notices.error('批量下载失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally { downloadBusy.current = false; setDownloading(false); }
  };
  const allSelected = assets.length > 0 && assets.every(asset => selected.has(asset.key));
  const selectionToggle = <button type="button" className="studio-text-button library-selection-toggle" aria-label="批量选择图片" aria-pressed={selecting} disabled={selectionBusy || (!selecting && !assets.length)} onClick={() => selecting ? finishSelection() : setSelecting(true)}>{selecting ? '取消' : '选择'}</button>;
  const actions = <>
    <button type="button" className="studio-icon" title={add.isPending ? '正在上传图片' : '上传图片'} aria-label={add.isPending ? '正在上传图片' : '上传图片'} aria-busy={add.isPending} disabled={add.isPending} onClick={() => fileInput.current?.click()}>{add.isPending ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}</button>
    <button className="studio-icon" title="创建主体" aria-label="创建主体" onClick={() => setCreatingSubject(true)}><Plus size={20} /></button>
  </>;
  return <div className="library-content"><header className={`library-header${mobilePage ? ' library-header-page' : ''}`}>
    {mobilePage && <h2 aria-live="polite">{selecting ? `已选 ${selected.size} 张` : '图库'}</h2>}
    {!selecting && <div className="library-filters"><label className="search-field"><Search size={18} /><input aria-label="搜索图片" placeholder="搜索图片名称" value={q} onChange={e => setQ(e.target.value)} /></label><select aria-label="图片来源" value={kind} onChange={e => setKind(e.target.value)}><option value="">全部图片</option><option value="generated">生成图片</option><option value="upload">上传图片</option><option value="subject">主体</option></select></div>}
    <div className="library-page-actions">{!selecting && actions}{selectionToggle}</div>
    </header>
    {selecting ? <div className="library-toolbar library-selection-toolbar">
      {!mobilePage && <span aria-live="polite">已选 {selected.size} 张</span>}
      <button className="studio-text-button" disabled={selectionBusy || !assets.length} onClick={() => setSelected(allSelected ? new Set() : new Set(assets.map(asset => asset.key)))}>{allSelected ? '取消全选' : '全选已加载图片'}</button>
      <button className="studio-secondary library-download" title="将所选图片打包下载为 ZIP" disabled={selectionBusy || !selected.size} onClick={downloadSelected}><Download size={16} />{downloading ? '打包中…' : '下载'}</button>
      <button className="studio-secondary library-remove" disabled={selectionBusy || !selected.size} onClick={removeSelected}><Trash2 size={16} />{removing ? '处理中…' : `移除（${selected.size}）`}</button>
    </div> : null}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { if (e.target.files?.[0]) add.mutate(e.target.files[0]); e.target.value = ''; }} />
    <div className="library-results">
    {query.isPending && <p className="studio-empty">正在加载图片</p>}{query.isError && <button className="studio-secondary" onClick={() => query.refetch()}>加载失败，重试</button>}
    {query.data?.pages[0].items.length === 0 && <p className="studio-empty">{q || kind ? '没有匹配的图片' : '图库为空'}</p>}
    <div className="asset-grid">{assets.map(asset => <article className={`asset-item ${selected.has(asset.key) ? 'is-selected' : ''}`} key={asset.key}>
      <div className="asset-media"><button className="asset-image" disabled={removing} aria-pressed={selecting ? selected.has(asset.key) : undefined} aria-label={`${selecting ? '选择图片' : '预览图片'}：${asset.title}`} onClick={() => selecting ? toggleSelected(asset.key) : onPreview(asset, assets)} title={selecting ? '选择图片' : '预览图片'}><img src={thumbnailUrl(asset)} alt={asset.title} loading="lazy" />{selecting && <span className="asset-selection-mark" data-selected={selected.has(asset.key)} aria-hidden="true">{selected.has(asset.key) && <Check size={15} />}</span>}</button><div className={`asset-actions ${selecting ? 'is-multi-select-hidden' : ''}`} aria-label={`图片操作：${asset.title}`}>
        <a className="studio-icon" href={asset.jobId ? `/api/image/jobs/${asset.jobId}/download/${asset.index}` : asset.url} download title="下载图片" aria-label="下载图片"><Download size={17} /></a>
        {asset.subjectId && asset.fileId && <button className="studio-icon" title="引用主体" aria-label={`引用主体：${asset.title}`} onClick={() => onSubject({ id: asset.subjectId!, name: asset.title, description: '', createdAt: asset.createdAt, file: { id: asset.fileId!, url: asset.url, mimeType: 'image/png', size: 0, createdAt: asset.createdAt } })}><AtSign size={17} /></button>}
        <button className="studio-icon is-danger" title="从图库移除" aria-label={`从图库移除：${asset.title}`} disabled={change.isPending} onClick={() => void removeAsset(asset)}><Trash2 size={17} /></button>
        <details className="asset-more"><summary className="studio-icon" title="更多操作" aria-label="更多操作"><MoreHorizontal size={18} /></summary><div className="asset-more-menu"><button onClick={() => { setEditing(asset); setTitle(asset.title.slice(0, 120)); }}><Pencil size={16} />重命名</button></div></details>
      </div></div>{asset.kind === 'subject' && <div className="subject-asset-label">{asset.title}</div>}
    </article>)}</div>
    {query.hasNextPage && <button className="studio-secondary history-more" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>加载更多</button>}
    </div>
    {editing && <Dialog title="重命名图片" onClose={() => setEditing(null)}><form className="studio-form settings-content" onSubmit={e => { e.preventDefault(); if (title.trim()) change.mutate({ key: editing.key, title: title.trim() }); }}><label>图片名称<input autoFocus maxLength={120} required value={title} onChange={e => setTitle(e.target.value)} /></label><button className="studio-primary" disabled={change.isPending || !title.trim()}>保存</button></form></Dialog>}
    {creatingSubject && <SubjectDialog files={[]} onClose={() => setCreatingSubject(false)} onSaved={() => { setCreatingSubject(false); setKind('subject'); }} />}
  </div>;
}
