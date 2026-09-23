'use client';

import { MoreHorizontal, RefreshCw } from 'lucide-react';

export function RefreshButton({ busy, onClick }: { busy?: boolean; onClick: () => void }) {
  return <button type="button" className="admin-icon-button" aria-label="刷新" title="刷新" disabled={busy} onClick={onClick}><RefreshCw size={17} className={busy ? 'animate-spin' : ''} /></button>;
}

export function EnabledSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" className="admin-toggle" aria-label={label} aria-checked={checked} title={`${label}：${checked ? '已启用' : '已停用'}`} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}

export function RowActions({ label, actions, disabled }: { label: string; actions: Array<{ label: string; onSelect: () => void; disabled?: boolean }>; disabled?: boolean }) {
  return <label className="admin-row-menu" title={label}>
    <MoreHorizontal size={18} aria-hidden />
    <select aria-label={label} value="" disabled={disabled} onChange={(event) => actions[Number(event.target.value)]?.onSelect()}>
      <option value="" disabled>更多操作</option>
      {actions.map((action, index) => <option key={action.label} value={index} disabled={action.disabled}>{action.label}</option>)}
    </select>
  </label>;
}
