'use client';

import { MoreHorizontal, RefreshCw } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export function RefreshButton({ busy, onClick }: { busy?: boolean; onClick: () => void }) {
  return <button type="button" className="admin-icon-button" aria-label="刷新" title="刷新" disabled={busy} onClick={onClick}><RefreshCw size={17} className={busy ? 'animate-spin' : ''} /></button>;
}

export function EnabledSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" className="admin-toggle" aria-label={label} aria-checked={checked} title={`${label}：${checked ? '已启用' : '已停用'}`} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

export function RowActions({ label, actions, disabled }: { label: string; actions: Array<{ label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="admin-action-menu" ref={menuRef}>
      <button
        type="button"
        className="admin-icon-button"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="admin-action-menu-dropdown">
          {actions.map((action, index) => (
            <button
              key={index}
              type="button"
              className={action.danger ? 'is-danger' : ''}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
