'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose, drawer = false, fullscreen = false, anchor, hideHeading = false, inline = false, popoverWidth = 440, className = '' }: {
  title: string; children: ReactNode; onClose: () => void; drawer?: boolean; fullscreen?: boolean; anchor?: HTMLElement | null; hideHeading?: boolean; inline?: boolean; popoverWidth?: number; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const startedOutside = useRef(false);
  const outside = (event: React.PointerEvent<HTMLDialogElement> | React.MouseEvent<HTMLDialogElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const position = () => {
      if (fullscreen) {
        const viewport = window.visualViewport;
        const height = viewport?.height ?? window.innerHeight;
        dialog.style.setProperty('--preview-height', `${height}px`);
        dialog.style.setProperty('--preview-top', `${viewport?.offsetTop ?? 0}px`);
        dialog.dataset.compact = String(height < 500);
      }
      if (!anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const width = Math.min(popoverWidth, window.innerWidth - 32);
      const bottom = Math.min(window.innerHeight - 112, Math.max(16, window.innerHeight - bounds.top + 8));
      dialog.style.setProperty('--popover-left', `${Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16))}px`);
      dialog.style.setProperty('--popover-width', `${width}px`);
      dialog.style.setProperty('--popover-bottom', `${bottom}px`);
      dialog.style.setProperty('--popover-height', `${window.innerHeight - bottom - 16}px`);
    };
    position(); window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    const observer = new ResizeObserver(position);
    if (anchor) observer.observe(anchor);
    // Keep children mounted when a navigation page becomes a desktop modal.
    if (inline) dialog.show();
    else { dialog.showModal(); document.body.style.overflow = 'hidden'; }
    return () => {
      dialog.close();
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      observer.disconnect();
      if (!inline) {
        document.body.style.overflow = overflow;
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      }
    };
  }, [anchor, fullscreen, inline, popoverWidth]);
  return <dialog ref={ref} aria-label={title} role={inline ? 'region' : undefined}
    className={`studio-dialog ${inline ? 'studio-inline-page studio-navigation-page' : ''} ${!fullscreen && !hideHeading ? 'has-heading' : ''} ${drawer ? 'studio-drawer' : ''} ${fullscreen ? 'studio-lightbox' : ''} ${anchor ? 'composer-popover' : ''} ${className}`}
    onPointerDown={event => { startedOutside.current = outside(event); }}
    onClick={event => { if (startedOutside.current && outside(event)) onClose(); startedOutside.current = false; }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    {!fullscreen && !hideHeading && <header className="dialog-heading"><h2>{title}</h2>
      {!inline && <button type="button" className="studio-icon" aria-label={`关闭${title}`} title="关闭" onClick={onClose}><X size={20} /></button>}
    </header>}
    {!fullscreen && !hideHeading ? <div className="dialog-body">{children}</div> : children}
  </dialog>;
}
