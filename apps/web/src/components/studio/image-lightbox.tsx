'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Download, Trash2, X, Pencil, MessageCirclePlus, Scan, Eraser, Scaling, ArrowUp, Loader2, ChevronDown } from 'lucide-react';
import { PreviewMarkup, type MarkupTool, type PreviewComment } from './preview-markup';
import { exportPreviewGuide, exportPreviewMask } from './preview-export';
import { usePreviewDraft } from './preview-draft';
import type { ImageJobCreateRequest } from '@picup/shared';

export type PreviewImage = { url: string; label: string; alt: string; meta?: string; downloadUrl?: string };
export type ImagePreviewMode = 'conversation' | 'gallery' | 'references';
type Point = { x: number; y: number };
type View = Point & { zoom: number };
const fit: View = { zoom: 1, x: 0, y: 0 };

export type PreviewEdit = { prompt: string; operation: NonNullable<ImageJobCreateRequest['previewOperation']>; comments: NonNullable<ImageJobCreateRequest['editComments']>; guide?: File; mask?: File; original?: File; aspectRatio?: string; onProgress?: (message: string) => void };
export function ImageLightbox({ title, mode = 'conversation', images, index, onIndexChange, onClose, onDelete, onSubmitEdit, ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2'], draftScope = 'local' }: {
  title: string; mode?: ImagePreviewMode; images: PreviewImage[]; index: number; onIndexChange: (index: number) => void; onClose: () => void; onDelete?: (image: PreviewImage) => void | Promise<void>;
  onSubmitEdit?: (image: PreviewImage, edit: PreviewEdit) => Promise<PreviewImage[] | null>;
  ratios?: string[];
  draftScope?: string;
}) {
  const [results, setResults] = useState<PreviewImage[]>([]);
  const [resultIndex, setResultIndex] = useState(0);
  const [compare, setCompare] = useState(false);
  const image = results[resultIndex] ?? images[index];
  const shown = compare ? images[index] : image;
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<MarkupTool>('view');
  const marking = tool !== 'view';
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const sendingRef = useRef(false);
  const [editError, setEditError] = useState('');
  const description = useRef<HTMLTextAreaElement>(null);
  const imageKey = `${draftScope}:${image?.url ?? ''}`;
  const [operation, setOperation] = usePreviewDraft(`operation:${imageKey}`, '');
  const [savedRatio, setRatio] = usePreviewDraft(`ratio:${imageKey}`, '1:1');
  const ratioChoices = ratios.filter(ratio => ratio !== 'auto');
  const aspectRatio = ratioChoices.includes(savedRatio) ? savedRatio : ratioChoices[0];
  const [editPrompt, setEditPrompt] = usePreviewDraft(`prompt:${imageKey}:${operation || 'describe'}`, '');
  const [comments, setComments] = usePreviewDraft<PreviewComment[]>(`comments:${imageKey}`, []);
  const [activeComment, setActiveComment] = useState<number | null>(null);
  const [extraDescription, setExtraDescription] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [view, setView] = useState(fit);
  const current = useRef(fit);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ center: Point; distance: number; view: View } | null>(null);
  const start = useRef<Point | null>(null);
  const moved = useRef(false);
  const clickGuard = useRef(false);
  const lastTap = useRef(0);
  function apply(next: View) {
    const zoom = Math.min(4, Math.max(1, next.zoom));
    const width = picture.current?.offsetWidth ?? 0;
    const height = picture.current?.offsetHeight ?? 0;
    const maxX = Math.max(0, (width * zoom - (stage.current?.clientWidth ?? width)) / 2);
    const maxY = Math.max(0, (height * zoom - (stage.current?.clientHeight ?? height)) / 2);
    current.current = { zoom, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    setView(current.current);
  }
  function measure() {
    const points = [...pointers.current.values()];
    const a = points[0]; const b = points[1] ?? a;
    return a ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) } : null;
  }
  function rebase() { const data = measure(); gesture.current = data ? { ...data, view: current.current } : null; }
  const moveIndex = useCallback((delta: number) => { if (!sending && index + delta >= 0 && index + delta < images.length) onIndexChange(index + delta); }, [index, images.length, onIndexChange, sending]);
  useEffect(() => {
    apply(fit); setFailed(false); setTool('view'); setActiveComment(null); setEditError(''); pointers.current.clear(); gesture.current = null; start.current = null; lastTap.current = 0;
  }, [index, image?.url]);
  useEffect(() => { setResults([]); setResultIndex(0); setCompare(false); }, [index, images]);
  useEffect(() => {
    setTool(operation === 'annotate' ? 'draw' : operation === 'remove' ? 'mask' : operation === 'comment' ? 'comment' : 'view');
    setActiveComment(null); setExtraDescription(false);
  }, [operation, imageKey]);
  useEffect(() => {
    const resize = () => apply(fit);
    const key = (event: KeyboardEvent) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof Element && event.target.closest('select'))) return; if (event.key === 'ArrowLeft') moveIndex(-1); if (event.key === 'ArrowRight') moveIndex(1); };
    window.addEventListener('resize', resize); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('keydown', key); };
  }, [index, images.length, moveIndex]);
  function choose(action: string) {
    if (action === 'background') { void removeBackground(); return; }
    setComments(comments.filter(comment => comment.text.trim()));
    if (operation === action) {
      setOperation(''); setTool('view'); setActiveComment(null); setEditError('');
      pointers.current.clear(); gesture.current = null; start.current = null;
      return;
    }
    setOperation(action); setEditError('');
    setCompare(false);
    setTool(action === 'annotate' ? 'draw' : action === 'remove' ? 'mask' : action === 'comment' ? 'comment' : 'view');
    pointers.current.clear(); gesture.current = null; start.current = null;
  }
  function addComment(point: Point) {
    const saved = comments.filter(comment => comment.text.trim());
    if (saved.length >= 12) { setEditError('最多添加 12 条评论'); return; }
    setComments([...saved, { ...point, text: '' }]); setActiveComment(saved.length);
  }
  function selectComment(index: number | null) {
    if (activeComment !== null && !comments[activeComment]?.text.trim() && index !== activeComment) {
      setComments(comments.filter((_, i) => i !== activeComment));
      setActiveComment(index === null ? null : index > activeComment ? index - 1 : index);
    } else setActiveComment(index);
  }
  const hasEdit = Boolean(editPrompt.trim() || (operation === 'comment' && comments.some(item => item.text.trim())) || ['background', 'remove', 'resize'].includes(operation));
  const canSend = !sending && !compare && !failed && hasEdit && Boolean(onSubmitEdit) && (operation !== 'resize' || Boolean(aspectRatio)) && (operation !== 'comment' || activeComment === null);
  const contextual = Boolean(operation && !compare);
  const composerVisible = !contextual || operation === 'annotate' || extraDescription;
  async function removeBackground() {
    if (!onSubmitEdit || sendingRef.current || failed || !picture.current?.naturalWidth) return;
    sendingRef.current = true; setSending(true); setEditError(''); setProgress('正在确认去除背景…');
    try { await onSubmitEdit(image, { operation: 'background', prompt: '', comments: [], onProgress: setProgress }); }
    catch (error) { setEditError(error instanceof Error ? error.message : '去除背景提交失败，请重试'); }
    finally { sendingRef.current = false; setSending(false); }
  }
  async function sendEdit() {
    if (!onSubmitEdit || !canSend || sendingRef.current || !picture.current?.naturalWidth) return;
    const overlay = stage.current?.querySelector<SVGSVGElement>('.preview-markup-layer');
    sendingRef.current = true; setSending(true); setEditError(''); setProgress('正在导出标记…');
    try {
      if (operation === 'resize' && !aspectRatio) throw new Error('当前模型不支持指定画面比例');
      const selection = overlay && operation === 'remove' ? await exportPreviewMask(picture.current, overlay) : undefined;
      if (operation === 'remove' && !selection) throw new Error('请先标记要移除的区域');
      const guide = overlay && ['annotate', 'comment'].includes(operation) ? await exportPreviewGuide(picture.current, overlay) : undefined;
      const next = await onSubmitEdit(image, { onProgress: setProgress, prompt: editPrompt.trim(), operation: (operation || 'describe') as PreviewEdit['operation'], comments: operation === 'comment' ? comments.map(item => ({ x: item.x / 10, y: Math.max(0, Math.min(100, item.y / (10 * picture.current!.naturalHeight / picture.current!.naturalWidth))), text: item.text })) : [], aspectRatio: operation === 'resize' ? aspectRatio : undefined, guide, mask: selection?.mask, original: selection?.original });
      if (next === null) return;
      if (!next.length) throw new Error('任务未返回图片，请重试');
      setResults(next); setResultIndex(0); setCompare(false);
    } catch (error) { setEditError(error instanceof Error ? error.message : '编辑提交失败，请重试'); }
    finally { sendingRef.current = false; setSending(false); }
  }
  if (!image) return null;
  const sendButton = <button type="button" className="preview-context-send" title="提交编辑" aria-label="提交编辑" disabled={!canSend} onClick={() => void sendEdit()}>{sending ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}<span>发送</span></button>;
  return <div className={`image-viewer image-viewer-${mode}`} data-operation={contextual ? operation : 'view'} aria-label={title}>
    <header><span>{shown.label}</span><div className="image-viewer-actions">{onDelete && !results.length && <button type="button" className="preview-delete" disabled={sending} onClick={() => void onDelete(image)} title="删除图片" aria-label="删除图片"><Trash2 size={20} /></button>}<a href={shown.downloadUrl ?? shown.url} download title="下载图片" aria-label="下载图片"><Download size={20} /></a><button disabled={sending} onClick={onClose} title="关闭预览" aria-label="关闭预览"><X size={22} /></button></div>
      <div className="preview-home-row" hidden={contextual}><div className="preview-action-tools" role="toolbar" aria-label="图片操作">
        {([['annotate', '标注', Pencil], ['comment', '评论', MessageCirclePlus], ['background', '去除背景', Scan], ['remove', '消除', Eraser]] as const).map(([action, label, Icon]) => <button key={action} title={label} aria-label={label} aria-pressed={action === 'background' ? undefined : operation === action} disabled={sending || failed} onClick={() => choose(action)}><Icon size={19} /><span>{label}</span></button>)}
        <label className="preview-resize-control" data-active={operation === 'resize'} title={ratioChoices.length ? '调整尺寸' : '当前模型不支持指定画面比例'}>
          <Scaling size={19} aria-hidden="true" />
          <select aria-label="调整尺寸" value={operation === 'resize' ? aspectRatio ?? '' : ''} disabled={sending || failed || !ratioChoices.length} onChange={event => { setRatio(event.target.value); if (operation !== 'resize') choose('resize'); }}>
            <option value="" disabled hidden>调整尺寸</option>
            {ratioChoices.map(ratio => {
              const [width, height] = ratio.split(':').map(Number);
              const scale = 23 / Math.max(width, height);
              return <option key={ratio} value={ratio} style={{ '--ratio-width': `${width * scale}px`, '--ratio-height': `${height * scale}px` } as CSSProperties}>{ratio}</option>;
            })}
          </select>
        </label>
      </div></div>
      <div className="preview-context-row" hidden={!contextual}>
        <div className="preview-context-bar" role="group" aria-label="当前操作">
          <div ref={setToolbar} className="preview-markup-toolbar" hidden={!['annotate', 'remove'].includes(operation)} />
          {operation === 'comment' && <div className="preview-context-label"><MessageCirclePlus size={19} /><span>{comments.some(item => item.text.trim()) ? `${comments.filter(item => item.text.trim()).length} 条评论` : '评论'}</span></div>}
          {operation === 'resize' && <label className="preview-context-ratio"><Scaling size={19} /><select aria-label="目标画面比例" value={aspectRatio} disabled={sending} onChange={event => setRatio(event.target.value)}>{ratioChoices.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>}
          {!['annotate', 'remove'].includes(operation) && <button className="preview-description-toggle" title="补充描述" aria-label="补充描述" aria-pressed={extraDescription} disabled={sending} onClick={() => setExtraDescription(value => !value)}><Pencil size={17} /></button>}
          <div className="preview-context-actions">{operation !== 'annotate' && sendButton}<span className="preview-tool-divider" /><button title="退出当前工具" aria-label="退出当前工具" disabled={sending} onClick={() => choose(operation)}><X size={20} /></button></div>
        </div>
      </div>
      {results.length > 0 && <div className="preview-result-tools"><button aria-pressed={!compare} disabled={sending} onClick={() => { setCompare(false); setTool('view'); }}>编辑结果</button><button aria-pressed={compare} disabled={sending} onClick={() => { setCompare(true); setTool('view'); }}>原图</button>{results.length > 1 && <select aria-label="编辑结果" value={resultIndex} onChange={event => { setResultIndex(Number(event.target.value)); setCompare(false); }}>{results.map((_, i) => <option key={i} value={i}>结果 {i + 1}</option>)}</select>}</div>}
    </header>
    <div ref={stage} className="image-viewer-stage" style={{ pointerEvents: sending ? 'none' : undefined }} onClick={() => { clickGuard.current = false; }} onWheel={event => { if (!marking) apply({ ...current.current, zoom: current.current.zoom + (event.deltaY > 0 ? -.2 : .2) }); }}
      onPointerDown={event => {
        if (marking) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = pointers.current.size === 1 ? { x: event.clientX, y: event.clientY } : null;
        rebase();
      }}
      onPointerMove={event => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const data = measure(); const base = gesture.current;
        if (!data || !base) return;
        if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) >= 8) moved.current = true;
        if (pointers.current.size === 1 && base.view.zoom === 1) return;
        const zoom = pointers.current.size > 1 ? Math.max(1, Math.min(4, base.view.zoom * data.distance / Math.max(1, base.distance))) : base.view.zoom;
        const rect = stage.current!.getBoundingClientRect();
        const scale = zoom / base.view.zoom;
        apply({ zoom, x: data.center.x - base.center.x + base.view.x * scale + (base.center.x - rect.left - rect.width / 2) * (1 - scale), y: data.center.y - base.center.y + base.view.y * scale + (base.center.y - rect.top - rect.height / 2) * (1 - scale) });
      }}
      onPointerUp={event => {
        const origin = start.current;
        clickGuard.current = moved.current;
        if (origin && pointers.current.size === 1) {
          const dx = event.clientX - origin.x; const dy = event.clientY - origin.y;
          if (current.current.zoom === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) moveIndex(dx < 0 ? 1 : -1);
          if (Math.hypot(dx, dy) < 8) { const now = Date.now(); if (now - lastTap.current < 300) { apply(current.current.zoom > 1 ? fit : { ...fit, zoom: 2 }); lastTap.current = 0; } else lastTap.current = now; }
        }
        start.current = null; moved.current = false; pointers.current.delete(event.pointerId); rebase();
      }}
      onPointerCancel={() => { pointers.current.clear(); gesture.current = null; start.current = null; }}>
      {failed ? <div className="image-viewer-error" role="alert"><p>图片暂时无法加载</p><button onClick={() => { setFailed(false); setRetry(value => value + 1); }}>重试</button></div> : <img key={`${shown.url}:${retry}`} ref={picture} src={shown.url} alt={shown.alt} draggable={false} onLoad={() => apply(current.current)} onError={() => setFailed(true)} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} />}
      {!failed && !compare && <PreviewMarkup picture={picture} toolbar={toolbar} imageKey={imageKey} mode={operation} disabled={sending} activeComment={activeComment} onSelectComment={selectComment} onUpdateComment={(i, text) => { setComments(comments.map((item, n) => n === i ? { ...item, text } : item)); setActiveComment(null); }} onDeleteComment={i => { setComments(comments.filter((_, n) => n !== i)); setActiveComment(null); }} tool={tool} onTool={setTool} comments={comments} onComment={addComment} transformKey={`${view.zoom}:${view.x}:${view.y}:${retry}`} onActive={() => { pointers.current.clear(); gesture.current = null; start.current = null; }} />}
    </div>
    <footer className="preview-editor-footer">
      {images.length > 1 && !contextual && <aside className="preview-editor-thumbs" aria-label="图片缩略图">{images.map((item, itemIndex) => <button type="button" disabled={sending} key={`${item.url}-${itemIndex}`} className={itemIndex === index ? 'selected' : ''} onClick={() => onIndexChange(itemIndex)} aria-label={`预览${item.label}`}><img src={item.url} alt="" /></button>)}</aside>}
      {composerVisible && <form className="preview-edit-composer" onSubmit={event => { event.preventDefault(); void sendEdit(); }}>
        <textarea ref={description} aria-label="描述编辑" placeholder={operation === 'annotate' ? '描述标记处的修改' : '描述编辑'} maxLength={3500} rows={1} value={editPrompt} disabled={sending || compare} onChange={event => setEditPrompt(event.target.value)} />
        <div className="preview-edit-submit">{contextual && operation !== 'annotate' ? <button type="button" title="收起描述" aria-label="收起描述" onClick={() => setExtraDescription(false)}><ChevronDown size={20} /></button> : <button type="submit" className="preview-edit-send" title="提交编辑" aria-label="提交编辑" disabled={!canSend}>{sending ? <Loader2 size={20} className="animate-spin" /> : <ArrowUp size={20} />}</button>}</div>
      </form>}
      {sending && <span className="preview-edit-status" role="status">{progress}</span>}
      {editError && <p className="preview-operation-error" role="alert">{editError}</p>}
    </footer>
  </div>;
}
