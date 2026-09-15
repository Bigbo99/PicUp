'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Pencil, Trash2, X } from 'lucide-react';

export type PreviewImage = { url: string; label: string; alt: string; meta?: string; downloadUrl?: string };
export type ImagePreviewMode = 'conversation' | 'gallery' | 'references';
type Point = { x: number; y: number };
type View = Point & { zoom: number };
const fit: View = { zoom: 1, x: 0, y: 0 };

export function ImageLightbox({ title, mode = 'conversation', images, index, onIndexChange, onClose, onEdit, onDelete }: {
  title: string; mode?: ImagePreviewMode; images: PreviewImage[]; index: number; onIndexChange: (index: number) => void; onClose: () => void; onEdit?: (image: PreviewImage) => void; onDelete?: (image: PreviewImage) => void | Promise<void>;
}) {
  const image = images[index];
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
  const moveIndex = useCallback((delta: number) => { if (index + delta >= 0 && index + delta < images.length) onIndexChange(index + delta); }, [index, images.length, onIndexChange]);
  useEffect(() => {
    apply(fit); setFailed(false); pointers.current.clear(); gesture.current = null; start.current = null; lastTap.current = 0;
  }, [index, image?.url]);
  useEffect(() => {
    const resize = () => apply(fit);
    const key = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft') moveIndex(-1); if (event.key === 'ArrowRight') moveIndex(1); };
    window.addEventListener('resize', resize); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('keydown', key); };
  }, [index, images.length, moveIndex]);
  if (!image) return null;
  return <div className={`image-viewer image-viewer-${mode}`} aria-label={title}>
    <header><span>{image.label} · {index + 1}/{images.length}</span><div className="image-viewer-actions">{onEdit && <button onClick={() => onEdit(image)} title="编辑图片" aria-label="编辑图片"><Pencil size={20} /></button>}<a href={image.downloadUrl ?? image.url} download title="下载图片" aria-label="下载图片"><Download size={20} /></a>{<button onClick={onClose} title="关闭预览" aria-label="关闭预览"><X size={22} /></button>}</div></header>
    {images.length > 1 && <aside className="image-viewer-thumbs" aria-label="图片缩略图">{images.map((item, itemIndex) => <button type="button" key={`${item.url}-${itemIndex}`} className={itemIndex === index ? 'selected' : ''} onClick={() => onIndexChange(itemIndex)} aria-label={`预览${item.label}`}><img src={item.url} alt="" /></button>)}</aside>}
    <div ref={stage} className="image-viewer-stage" onClick={event => { if (event.target === event.currentTarget && !clickGuard.current) onClose(); clickGuard.current = false; }} onWheel={event => apply({ ...current.current, zoom: current.current.zoom + (event.deltaY > 0 ? -.2 : .2) })}
      onPointerDown={event => {
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
      {failed ? <div className="image-viewer-error" role="alert"><p>图片暂时无法加载</p><button onClick={() => { setFailed(false); setRetry(value => value + 1); }}>重试</button></div> : <img key={`${image.url}:${retry}`} ref={picture} src={image.url} alt={image.alt} draggable={false} onLoad={() => apply(current.current)} onError={() => setFailed(true)} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} />}
    </div>
    <footer>{onDelete && <button onClick={() => void onDelete(image)} title="删除图片" aria-label="删除图片"><Trash2 size={20} /></button>}</footer>
  </div>;
}
