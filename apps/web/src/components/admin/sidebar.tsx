'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Home, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { AuthUser } from '@picup/shared';

export type AdminNavItem<T extends string> = { id: T; label: string; group: string; icon: React.ReactNode };

const COLLAPSED_KEY = 'picup.admin.sidebarCollapsed';

export function AdminSidebar<T extends string>({ items, active, onSelect, user, onLogout }: {
  items: Array<AdminNavItem<T>>;
  active: T;
  onSelect: (id: T) => void;
  user: AuthUser;
  onLogout: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const roleLabel = user.isSuperAdmin ? '超级管理员' : '管理员';
  const toggle = () => setCollapsed((value) => {
    localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
    return !value;
  });
  const groups = [...new Set(items.map((item) => item.group))];

  // Read before first paint so a persisted rail does not animate in from the expanded width.
  useLayoutEffect(() => setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1'), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside className={`admin-sidebar ${collapsed ? 'admin-sidebar-collapsed' : ''}`}>
      <div className="admin-sidebar-header">
        <Link className="admin-brand" href="/" aria-label="返回 PicUp 工作台" data-tooltip="PicUp 工作台">
          <img src="/brand/picup-icon.png" width="32" height="32" alt="" />
          <span className="admin-sidebar-label"><strong>PicUp</strong><small>管理后台</small></span>
        </Link>
        <div className="admin-sidebar-mobile-actions lg:hidden">
          <span className="admin-role-label">{roleLabel}</span>
          <Link className="admin-icon-button" href="/" title="返回工作台" aria-label="返回工作台"><Home size={18} aria-hidden /></Link>
          <button className="admin-icon-button" onClick={onLogout} title="退出登录" aria-label="退出登录"><LogOut size={18} aria-hidden /></button>
        </div>
      </div>

      <nav className="admin-nav" aria-label="后台导航">
        {groups.map((group) => (
          <div className="admin-nav-group" key={group}>
            <p className="admin-nav-group-label"><span className="admin-sidebar-label">{group}</span></p>
            {items.filter((item) => item.group === group).map((item) => (
              <button
                key={item.id}
                className={`admin-nav-item ${active === item.id ? 'is-active' : ''}`}
                onClick={() => onSelect(item.id)}
                aria-current={active === item.id ? 'page' : undefined}
                data-tooltip={item.label}
              >
                <span className="admin-nav-icon">{item.icon}</span>
                <span className="admin-sidebar-label">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="admin-sidebar-footer">
        <button
          className="admin-nav-item"
          onClick={toggle}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!collapsed}
          data-tooltip="展开侧边栏 (Ctrl+B)"
        >
          <span className="admin-nav-icon">{collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}</span>
          <span className="admin-sidebar-label">收起侧边栏</span>
          <kbd className="admin-sidebar-label admin-nav-kbd">Ctrl B</kbd>
        </button>
        <UserMenu user={user} roleLabel={roleLabel} collapsed={collapsed} onLogout={onLogout} />
      </div>
    </aside>
  );
}

function UserMenu({ user, roleLabel, collapsed, onLogout }: { user: AuthUser; roleLabel: string; collapsed: boolean; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const name = user.displayName || user.email || '管理员';

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector<HTMLElement>('.admin-user-button')?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="admin-user-menu-root" ref={root}>
      <button
        className="admin-user-button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`账号菜单：${name}`}
        data-tooltip={collapsed && !open ? name : undefined}
      >
        <span className="admin-user-avatar">{(user.displayName || user.email || user.id).slice(0, 1).toUpperCase()}</span>
        <span className="admin-sidebar-label admin-user-info"><strong>{name}</strong><small>{roleLabel}</small></span>
        <ChevronsUpDown className="admin-sidebar-label" size={15} aria-hidden />
      </button>
      {open && (
        <div className="admin-user-menu" role="menu" aria-label="账号菜单">
          <div className="admin-user-menu-header">
            <strong>{name}</strong>
            <small>{user.email ?? roleLabel}</small>
          </div>
          <Link role="menuitem" href="/" onClick={() => setOpen(false)}><Home size={16} aria-hidden />返回工作台</Link>
          <button role="menuitem" className="is-danger" onClick={() => { setOpen(false); onLogout(); }}><LogOut size={16} aria-hidden />退出登录</button>
        </div>
      )}
    </div>
  );
}
