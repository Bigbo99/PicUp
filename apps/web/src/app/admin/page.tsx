'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  ChevronDown,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  FileImage,
  Infinity as InfinityIcon,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  XCircle
} from 'lucide-react';
import type {
  AdminAuditLogRecord,
  AdminJobsResponse,
  AdminOverviewResponse,
  AdminProviderHealthResponse,
  AdminUsersResponse,
  AuthUser,
  ImageJobRecord,
  ImageJobStatus
} from '@picup/shared';
import { getMe, logout } from '@/lib/api';
import {
  deleteAdminUser,
  getAdminOverview,
  getAdminProviderHealth,
  listAdminAuditLogs,
  listAdminJobs,
  listAdminUsers,
  updateAdminUser,
  updateAdminUserStatus
} from '@/lib/admin-api';
import { useNotifications } from '@/components/notification-provider';
import { AiConfigPanel } from '@/components/admin/ai-config-panel';
import { RefreshButton } from '@/components/admin/controls';
import { AdminSidebar, type AdminNavItem } from '@/components/admin/sidebar';

type AdminTab = 'overview' | 'users' | 'jobs' | 'models' | 'audit';
type AdminUserDraft = Parameters<typeof updateAdminUser>[1];

const tabs: Array<AdminNavItem<AdminTab>> = [
  { id: 'overview', label: '概览', group: '运营', icon: <BarChart3 size={18} aria-hidden /> },
  { id: 'users', label: '用户', group: '运营', icon: <Users size={18} aria-hidden /> },
  { id: 'jobs', label: '任务', group: '运营', icon: <ClipboardList size={18} aria-hidden /> },
  { id: 'models', label: '模型服务', group: '系统', icon: <SlidersHorizontal size={18} aria-hidden /> },
  { id: 'audit', label: '操作记录', group: '系统', icon: <ShieldCheck size={18} aria-hidden /> }
];

function usersFromResponse(response?: AdminUsersResponse) {
  if (!response) return [];
  return Array.isArray(response) ? response : response.users;
}

function jobsFromResponse(response?: AdminJobsResponse) {
  if (!response) return [];
  return Array.isArray(response) ? response : response.jobs;
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatGeo(country?: string | null, region?: string | null, city?: string | null) {
  return [country || '未知', region, city].filter(Boolean).join(' / ');
}

function statusTone(status: string) {
  if (['active', 'succeeded', 'healthy', 'enabled', 'paid'].includes(status)) return 'is-success';
  if (['running', 'queued', 'retrying', 'degraded', 'pending'].includes(status)) return 'is-warning';
  if (['failed', 'disabled', 'closed'].includes(status)) return 'is-danger';
  return 'is-neutral';
}

function labelFor(value: string) {
  const labels: Record<string, string> = {
    active: '正常',
    pending: '待处理',
    disabled: '已禁用',
    closed: '已关闭',
    paid: '已支付',
    guest: '游客',
    user: '用户',
    admin: '管理员',
    queued: '排队中',
    running: '运行中',
    retrying: '重试中',
    succeeded: '成功',
    failed: '失败',
    refunded: '已退回',
    healthy: '健康',
    degraded: '异常',
    unknown: '未知',
    enabled: '已启用',
    gemini: 'Gemini',
    grsai: 'GrsAI',
    'gemini-official': 'Gemini Official',
    tokenrun: 'TokenRun',
    'user.quota_unlimited.update': '更新用户无限额度',
    'user.status.update': '更新用户状态',
    'user.credits.adjust': '调整用户额度',
    'user.delete': '删除用户',
    'user.profile.update': '保存用户信息',
    'model_config.update': '更新模型配置',
    'app_setting.upsert': '保存功能设置'
  };
  return labels[value] ?? value;
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const meQuery = useQuery({ queryKey: ['me'], queryFn: getMe });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login?next=/admin';
    }
  });
  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (tabs.some((tab) => tab.id === requestedTab)) setActiveTab(requestedTab as AdminTab);
  }, []);
  const selectTab = (tab: AdminTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };

  if (meQuery.isLoading) {
    return <CenteredState icon={<Loader2 className="animate-spin" size={28} />} title="正在验证管理员身份" />;
  }

  if (meQuery.error) {
    return (
      <CenteredState
        icon={<Lock size={28} />}
        title="需要登录"
        detail="请先登录管理员账号，再进入后台。"
        action={<Link className="admin-primary-button" href="/login?next=/admin">去登录</Link>}
      />
    );
  }

  if (!meQuery.data) {
    return <CenteredState icon={<Loader2 className="animate-spin" size={28} />} title="正在加载后台数据" />;
  }

  const user = meQuery.data.user;
  if (user.role !== 'admin') {
    return (
      <CenteredState
        icon={<XCircle size={28} />}
        title="没有后台权限"
        detail="当前账号不是管理员，无法访问 PicUp 后台管理。"
        action={<Link className="admin-secondary-button" href="/">返回工作台</Link>}
      />
    );
  }

  return (
    <main className="admin-shell">
      <div className="admin-layout">
        <AdminSidebar items={tabs} active={activeTab} onSelect={selectTab} user={user} onLogout={() => logoutMutation.mutate()} />

        <section className="admin-content">
          <header className="admin-page-header"><div><p>管理后台</p><h1>{tabs.find((tab) => tab.id === activeTab)?.label}</h1></div></header>

          {activeTab === 'overview' && <OverviewTab onOpenJobs={() => selectTab('jobs')} onOpenModels={() => selectTab('models')} />}
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'jobs' && <JobsTab />}
          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'audit' && <AuditTab />}
        </section>
      </div>
    </main>
  );
}

function OverviewTab({ onOpenJobs, onOpenModels }: { onOpenJobs: () => void; onOpenModels: () => void }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState('24h');
  const overviewQuery = useQuery({
    queryKey: ['admin', 'overview', range],
    queryFn: () => getAdminOverview(range),
    refetchInterval: 30000
  });
  const providersQuery = useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: getAdminProviderHealth,
    refetchInterval: 30000
  });
  const overview = overviewQuery.data;
  const periodFailures = (overview?.jobs.failed ?? 0) + (overview?.jobs.refunded ?? 0);
  const completed = (overview?.jobs.succeeded ?? 0) + periodFailures;
  const activeJobs = (overview?.jobs.queued ?? 0) + (overview?.jobs.running ?? 0) + (overview?.jobs.retrying ?? 0);
  const activeStatusRows = (['queued', 'running', 'retrying'] as ImageJobStatus[]).map((status) => ({
    status,
    value: overview?.jobs[status] ?? 0
  }));
  const updatedAt = overviewQuery.dataUpdatedAt
    ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(overviewQuery.dataUpdatedAt)
    : '';

  if (overviewQuery.isPending) {
    return <div className="admin-loading-grid" aria-label="正在加载概览">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div>;
  }
  if (overviewQuery.isError && !overview) {
    return <div className="admin-toolbar"><p role="alert">概览数据加载失败</p><RefreshButton busy={overviewQuery.isFetching} onClick={() => void overviewQuery.refetch()} /></div>;
  }
  if (!overview) {
    return <div className="admin-toolbar"><p role="status">概览数据暂不可用</p><RefreshButton onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] })} /></div>;
  }

  return (
    <div className="admin-overview">
      <div className="admin-overview-controls">
        <span>{updatedAt ? `${updatedAt} 更新` : '自动更新'}</span>
        <RefreshButton busy={overviewQuery.isFetching} onClick={() => void queryClient.invalidateQueries({ queryKey: ['admin'] })} />
        <Segmented value={range} onChange={setRange} options={[['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['all', '全部']]} />
      </div>

      <section className="admin-metrics-strip" aria-label="关键指标">
        <DashboardMetric label="周期任务" value={overview.jobs.rangeCreated} sub={`历史累计 ${overview.totals.jobs}`} />
        <DashboardMetric label="周期成功率" value={`${overview.jobs.successRate}%`} sub={`${completed} 个已完成`} tone={overview.jobs.successRate < 90 ? 'warning' : 'default'} />
        <DashboardMetric label="当前处理中" value={activeJobs} sub={`${overview.jobs.running} 运行 · ${overview.jobs.queued} 排队 · ${overview.jobs.retrying} 重试`} tone={activeJobs > 0 ? 'accent' : 'default'} />
        <DashboardMetric label="周期失败" value={periodFailures} sub={periodFailures ? `${overview.jobs.refunded} 个已退回积分` : '当前周期无失败'} tone={periodFailures ? 'danger' : 'default'} />
      </section>

      <div className="admin-overview-main">
        <Panel title="模型表现" action={<button className="admin-text-button" onClick={onOpenModels}>管理模型 <ArrowRight size={14} /></button>}>
          <ModelUsageChart models={overview?.models ?? []} />
        </Panel>
        <Panel title="运行状态">
          <OperationsPanel rows={activeStatusRows} providers={providersQuery.data} providersPending={providersQuery.isPending} providersError={providersQuery.isError} onOpenModels={onOpenModels} />
        </Panel>
      </div>

      <Panel title="最近失败" action={<button className="admin-text-button" onClick={onOpenJobs}>查看任务 <ArrowRight size={14} /></button>}>
        <JobMiniList jobs={overview?.recentFailures ?? []} />
      </Panel>
    </div>
  );
}

function OperationsPanel({ rows, providers, providersPending, providersError, onOpenModels }: {
  rows: Array<{ status: ImageJobStatus; value: number }>;
  providers?: AdminProviderHealthResponse;
  providersPending: boolean;
  providersError: boolean;
  onOpenModels: () => void;
}) {
  return (
    <div className="admin-operations">
      <div className="admin-status-list">
        {rows.map((row) => <div key={row.status}><span><i data-status={row.status} />{labelFor(row.status)}</span><strong>{row.value}</strong></div>)}
      </div>
      <div className="admin-subsection-heading"><span>服务商配置</span><small>检查连接参数与启用状态</small></div>
      {providersPending && <p className="admin-inline-note">正在读取配置…</p>}
      {providersError && <p className="admin-inline-error">配置状态读取失败</p>}
      <div className="admin-provider-list">
        {(providers?.providers ?? []).map((provider) => (
          <button key={provider.provider} onClick={onOpenModels}>
            <span><strong>{labelFor(provider.provider)}</strong><small>{provider.enabledModels} 个启用模型</small></span>
            <span className={`admin-config-status ${provider.status === 'disabled' ? 'is-neutral' : provider.configured && provider.enabledModels > 0 ? 'is-success' : 'is-warning'}`}>
              {provider.status === 'disabled' ? '已禁用' : provider.configured && provider.enabledModels > 0 ? '已配置' : '需配置'}
            </span>
          </button>
        ))}
        {!providersPending && !providersError && providers?.providers.length === 0 && <EmptyLine text="暂无服务商配置" />}
      </div>
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [quotaFilter, setQuotaFilter] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [settingsUserId, setSettingsUserId] = useState<string | null>(null);
  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: '50' });
    if (query.trim()) value.set('query', query.trim());
    if (role) value.set('role', role);
    if (status) value.set('status', status);
    if (quotaFilter) value.set('quotaUnlimited', quotaFilter);
    if (cursors.length) value.set('cursor', cursors[cursors.length - 1]);
    return value;
  }, [cursors, query, quotaFilter, role, status]);
  const usersQuery = useQuery({ queryKey: ['admin', 'users', params.toString()], queryFn: () => listAdminUsers(params) });
  const users = usersFromResponse(usersQuery.data);
  const nextCursor = usersQuery.data && !Array.isArray(usersQuery.data) ? usersQuery.data.nextCursor : undefined;
  const settingsUser = users.find((user) => user.id === settingsUserId) ?? null;
  const saveUserMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminUserDraft }) => updateAdminUser(id, input),
    onSuccess: () => {
      notifications.success('用户信息已保存');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (error) => notifications.error('保存失败', error instanceof Error ? error.message : '请稍后重试')
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AuthUser['status'] }) => updateAdminUserStatus(id, status, 'admin_console'),
    onSuccess: () => {
      notifications.success('用户状态已更新');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => notifications.error('更新失败', error instanceof Error ? error.message : '请稍后重试')
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminUser(id),
    onSuccess: () => {
      notifications.success('用户已删除');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (error) => notifications.error('删除失败', error instanceof Error ? error.message : '请稍后重试')
  });

  return (
    <Panel title="用户列表" flat>
      <Toolbar>
        <SearchBox value={query} onChange={(value) => { setQuery(value); setCursors([]); }} placeholder="搜索邮箱、昵称或 ID" label="搜索用户" />
        <RefreshButton busy={usersQuery.isFetching} onClick={() => void usersQuery.refetch()} />
        <AdminSelect label="账号类型" value={role} onChange={(value) => { setRole(value); setCursors([]); }} options={[['', '全部账号'], ['guest', '游客'], ['user', '注册用户'], ['admin', '管理员']]} />
        <AdminSelect label="账号状态" value={status} onChange={(value) => { setStatus(value); setCursors([]); }} options={[['', '全部状态'], ['active', '正常'], ['pending', '待处理'], ['disabled', '已禁用']]} />
        <AdminSelect label="额度类型" value={quotaFilter} onChange={(value) => { setQuotaFilter(value); setCursors([]); }} options={[['', '全部额度'], ['true', '无限额度'], ['false', '普通额度']]} />
      </Toolbar>
      {usersQuery.isError && <p className="admin-inline-error" role="alert">用户加载失败，请刷新重试。</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>角色</th>
              <th>状态</th>
              <th>余额</th>
              <th>来源</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <p className="font-black">{user.displayName || user.email || `${user.isGuest ? '游客' : '注册用户'} ${user.id.slice(0, 8)}`}</p>
                  <p className="text-xs text-slate-500">{user.email ?? user.id}</p>
                </td>
                <td><Badge value={user.role} /></td>
                <td><Badge value={user.status} /></td>
                <td>{user.quotaUnlimited ? '无限' : user.creditBalance}</td>
                <td>
                  <p className="text-sm font-bold">{user.lastIp ?? '-'}</p>
                  <p className="text-xs text-slate-500">{formatGeo(user.lastCountry, user.lastRegion, user.lastCity)}</p>
                </td>
                <td>{formatDate(user.createdAt)}</td>
                <td>
                  <select
                    className="admin-row-action-select"
                    value=""
                    aria-label={`${user.email ?? user.displayName ?? user.id} 的操作`}
                    onChange={(event) => {
                      const action = event.target.value;
                      if (action === 'edit') setSettingsUserId(user.id);
                      if (action === 'status') {
                        const nextStatus = user.status === 'disabled' ? 'active' : 'disabled';
                        if (window.confirm(`确认${nextStatus === 'disabled' ? '禁用' : '启用'}该用户？`)) statusMutation.mutate({ id: user.id, status: nextStatus });
                      }
                      if (action === 'delete') {
                        const label = user.email ?? user.displayName ?? user.id;
                        if (window.confirm(`确认删除用户 ${label}？该操作会保留历史任务和文件记录，但账号本身将被删除。`)) deleteMutation.mutate(user.id);
                      }
                    }}
                  >
                    <option value="">操作</option>
                    <option value="edit">编辑用户</option>
                    <option value="status">{user.status === 'disabled' ? '启用用户' : '禁用用户'}</option>
                    <option value="delete">删除用户</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {usersQuery.isPending ? <EmptyLine text="正在加载用户…" /> : users.length === 0 && <EmptyLine text="没有符合条件的用户" />}
      <nav className="admin-pagination" aria-label="用户分页">
        <span>第 {cursors.length + 1} 页</span>
        <button className="admin-icon-button" title="上一页" aria-label="上一页" disabled={!cursors.length || usersQuery.isPending} onClick={() => setCursors((value) => value.slice(0, -1))}><ChevronLeft size={17} /></button>
        <button className="admin-icon-button" title="下一页" aria-label="下一页" disabled={!nextCursor || usersQuery.isPending} onClick={() => { if (nextCursor) setCursors((value) => [...value, nextCursor]); }}><ChevronRight size={17} /></button>
      </nav>
      {settingsUser && (
        <UserSettingsDialog
          user={settingsUser}
          busy={saveUserMutation.isPending}
          onClose={() => setSettingsUserId(null)}
          onSave={(input) => saveUserMutation.mutate({ id: settingsUser.id, input })}
        />
      )}
    </Panel>
  );
}

function UserSettingsDialog({
  user,
  busy,
  onClose,
  onSave
}: {
  user: AuthUser;
  busy: boolean;
  onClose: () => void;
  onSave: (input: AdminUserDraft) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [role, setRole] = useState<Extract<AuthUser['role'], 'user' | 'admin'>>(user.role === 'admin' ? 'admin' : 'user');
  const [status, setStatus] = useState<AuthUser['status']>(user.status);
  const [creditBalance, setCreditBalance] = useState(String(user.creditBalance));
  const [quotaUnlimited, setQuotaUnlimited] = useState(user.quotaUnlimited);
  const title = user.displayName || user.email || user.id;
  const canSave = Number.isInteger(Number(creditBalance)) && Number(creditBalance) >= 0;
  const roleLocked = Boolean(user.isSuperAdmin || user.isGuest);

  return (
    <div className="admin-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="user-settings-title">
      <button className="admin-dialog-dismiss" type="button" onClick={onClose} aria-label="关闭用户设置" />
      <section className="admin-dialog admin-user-dialog">
        <header className="admin-dialog-header">
          <div>
            <span>编辑用户</span>
            <h3 id="user-settings-title">{title}</h3>
            <p>{user.email ?? user.id}</p>
          </div>
          <button className="admin-icon-button" type="button" onClick={onClose} title="关闭" aria-label="关闭">
            <XCircle size={18} aria-hidden />
          </button>
        </header>

        <div className="admin-dialog-body">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="admin-form-section">
              <div className="mb-4 flex items-center gap-3">
                <div className="admin-section-icon">
                  <Users size={20} aria-hidden />
                </div>
                <div>
                  <h4 className="font-black text-slate-950">基本信息</h4>
                  <p className="text-sm text-slate-500">账号、身份和时间信息</p>
                </div>
              </div>
              <div className="grid gap-3">
                <UserDetailLine label="用户 ID" value={user.id} mono />
                <label className="grid gap-1">
                  <span className="text-xs font-black text-slate-500">邮箱</span>
                  <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-teal-600" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="用户邮箱" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-black text-slate-500">显示名称</span>
                  <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-teal-600" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名称" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-black text-slate-500">角色</span>
                  <select className="admin-field-select" value={user.isGuest ? 'guest' : roleLocked ? 'admin' : role} disabled={roleLocked} onChange={(event) => setRole(event.target.value as Extract<AuthUser['role'], 'user' | 'admin'>)}>
                    {user.isGuest ? <option value="guest">游客</option> : <><option value="user">用户</option><option value="admin">管理员</option></>}
                  </select>
                  {roleLocked && <span className="text-xs text-slate-500">{user.isGuest ? '游客身份只会在完成注册或微信认证后升级' : '超级管理员角色不可修改'}</span>}
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-black text-slate-500">状态</span>
                  <Segmented value={status} onChange={(value) => setStatus(value as AuthUser['status'])} options={[['active', '正常'], ['pending', '待处理'], ['disabled', '已禁用']]} />
                </label>
                <UserDetailLine label="账号类型" value={user.isGuest ? '游客' : '注册用户'} />
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-slate-500">IP 来源</p>
                      <p className="mt-1 break-all font-mono text-sm font-bold">{user.lastIp ?? '-'}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatGeo(user.lastCountry, user.lastRegion, user.lastCity)} · {formatDate(user.lastSeenAt ?? undefined)}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">登录自动更新</span>
                  </div>
                </div>
                <UserDetailLine label="邮箱验证" value={user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : '未验证'} />
                <UserDetailLine label="创建时间" value={formatDate(user.createdAt)} />
                <UserDetailLine label="更新时间" value={formatDate(user.updatedAt)} />
              </div>
            </section>

            <div className="grid gap-4">
              <section className="admin-form-section">
                <div className="mb-4 flex items-center gap-3">
                  <div className="admin-section-icon">
                    <InfinityIcon size={20} aria-hidden />
                  </div>
                  <div>
                    <h4 className="font-black text-slate-950">额度设置</h4>
                    <p className="text-sm text-slate-500">余额和无限额度管理</p>
                  </div>
                </div>
                <label className="grid gap-1">
                  <span className="text-xs font-black text-slate-500">额度余额</span>
                  <input
                    className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-teal-600"
                    value={creditBalance}
                    onChange={(event) => setCreditBalance(event.target.value)}
                    placeholder="额度余额"
                  />
                </label>
                <label className="mt-3 flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3">
                  <span className="text-sm font-black text-slate-700">无限额度</span>
                  <input type="checkbox" checked={quotaUnlimited} onChange={(event) => setQuotaUnlimited(event.target.checked)} />
                </label>
              </section>

              <section className="admin-form-section">
                <div className="mb-4 flex items-center gap-3">
                  <div className="admin-section-icon">
                    <Lock size={20} aria-hidden />
                  </div>
                  <div>
                    <h4 className="font-black text-slate-950">状态设置</h4>
                    <p className="text-sm text-slate-500">启用、待处理或禁用账号</p>
                  </div>
                </div>
                <button
                  className="admin-primary-button w-full"
                  disabled={busy || !canSave}
                  onClick={() => onSave({
                    displayName: displayName.trim() || null,
                    email: email.trim() || null,
                    role: user.isGuest ? undefined : role,
                    status,
                    creditBalance: Number(creditBalance),
                    quotaUnlimited
                  })}
                >
                  <Save size={16} aria-hidden />
                  保存修改
                </button>
                {!canSave && <p className="mt-2 text-xs text-red-600">额度余额必须是非负整数</p>}
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function UserDetailLine({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="admin-detail-line">
      <span>{label}</span>
      <strong className={mono ? 'font-mono' : ''}>{value}</strong>
    </div>
  );
}

function JobsTab() {
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: '50' });
    if (status) value.set('status', status);
    if (userId.trim()) value.set('userId', userId.trim());
    if (cursors.length) value.set('cursor', cursors[cursors.length - 1]);
    return value;
  }, [status, userId, cursors]);
  const jobsQuery = useQuery({
    queryKey: ['admin', 'jobs', params.toString()],
    queryFn: () => listAdminJobs(params),
    refetchInterval: 10000
  });
  const jobs = jobsFromResponse(jobsQuery.data);
  const nextCursor = jobsQuery.data && !Array.isArray(jobsQuery.data) ? jobsQuery.data.nextCursor : undefined;
  const activeIndex = jobs.findIndex((job) => job.id === activeJobId);
  const activeJob = activeIndex >= 0 ? jobs[activeIndex] : null;

  return (
    <Panel title="任务列表" flat>
      <Toolbar>
        <SearchBox value={userId} onChange={value => { setUserId(value); setCursors([]); }} placeholder="按用户 ID 筛选" label="按用户 ID 筛选任务" />
        <AdminSelect label="任务状态" value={status} onChange={value => { setStatus(value); setCursors([]); }} options={[['', '全部状态'], ['queued', '排队中'], ['running', '运行中'], ['retrying', '重试中'], ['succeeded', '已成功'], ['failed', '已失败'], ['refunded', '失败且已退回']]} />
        <button className="admin-icon-button" aria-label="刷新任务" title="刷新任务" disabled={jobsQuery.isFetching} onClick={() => void jobsQuery.refetch()}><RefreshCw size={17} /></button>
      </Toolbar>
      {jobsQuery.isError && <p role="alert">任务加载失败，请刷新重试。</p>}
      <div className="admin-table-wrap"><table className="admin-table admin-job-table"><thead><tr><th>任务 / 用户需求</th><th>状态</th><th>执行模型</th><th>积分</th><th>创建时间</th><th>详情</th></tr></thead><tbody>
        {jobs.map((job) => <JobRow key={job.id} job={job} onOpen={() => setActiveJobId(job.id)} />)}
      </tbody></table></div>
      {jobsQuery.isPending ? <EmptyLine text="正在加载任务…" /> : jobs.length === 0 && <EmptyLine text="暂无任务" />}
      <nav className="admin-pagination" aria-label="任务分页">
        <span>第 {cursors.length + 1} 页</span>
        <button className="admin-icon-button" title="上一页" aria-label="上一页" disabled={!cursors.length || jobsQuery.isPending} onClick={() => setCursors(value => value.slice(0, -1))}><ChevronLeft size={17} /></button>
        <button className="admin-icon-button" title="下一页" aria-label="下一页" disabled={!nextCursor || jobsQuery.isPending} onClick={() => { if (nextCursor) setCursors(value => [...value, nextCursor]); }}><ChevronRight size={17} /></button>
      </nav>
      {activeJob && (
        <JobDetailDialog
          key={activeJob.id}
          job={activeJob}
          index={activeIndex}
          total={jobs.length}
          onClose={() => setActiveJobId(null)}
          onPrev={activeIndex > 0 ? () => setActiveJobId(jobs[activeIndex - 1].id) : undefined}
          onNext={activeIndex < jobs.length - 1 ? () => setActiveJobId(jobs[activeIndex + 1].id) : undefined}
        />
      )}
    </Panel>
  );
}

function JobRow({ job, onOpen }: { job: ImageJobRecord; onOpen: () => void }) {
  const thumbnail = job.outputImages[0]?.url ?? job.inputFiles[0]?.url;
  const route = job.providerRoute ?? [];
  const routeLabel = route.length > 1 ? `回退：${route.map(item => labelFor(item.provider)).join(' → ')}` : (job.previewOperation ? '系统自动匹配' : labelFor(job.selectedProvider));
  return <tr><td><button className="admin-job-summary" onClick={onOpen}>{thumbnail ? <img src={thumbnail} alt="任务缩略图" /> : <FileImage size={24} />}<span><strong>{job.prompt || '图片编辑'}</strong><small>{job.id}</small></span></button></td><td><Badge value={job.status} /></td><td>{job.selectedModel}<small className="block text-slate-500">{routeLabel}</small></td><td>{job.paymentMode === 'credits' ? job.creditsReserved : 0}</td><td>{formatDate(job.createdAt)}</td><td><button className="admin-icon-button" aria-label={`查看任务 ${job.id}`} title="查看任务" onClick={onOpen}><ArrowRight size={18} /></button></td></tr>;
}

function JobDetailDialog({
  job,
  index,
  total,
  onClose,
  onPrev,
  onNext
}: {
  job: ImageJobRecord;
  index: number;
  total: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detailTab, setDetailTab] = useState<'result' | 'system'>('result');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const galleryImages = [
    ...job.inputFiles.map((file, fileIndex) => ({ url: file.url, label: file.id === job.guideFileId ? '系统标记指引' : job.previewOperation ? '编辑原图' : `用户参考图 ${fileIndex + 1}`, meta: file.mimeType })),
    ...(job.maskFile ? [{ url: job.maskFile.url, label: '系统蒙版', meta: job.maskFile.mimeType }] : []),
    ...job.outputImages.map((image, imageIndex) => ({ url: image.url, label: `结果图 ${imageIndex + 1}`, meta: `结果 ${imageIndex + 1}` }))
  ];
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const lightboxImage = lightboxIndex !== null ? galleryImages[lightboxIndex] : null;
  const inputCount = job.inputFiles.length + (job.maskFile ? 1 : 0);

  return (
    <dialog ref={dialog} className="admin-job-inspector" aria-labelledby="job-detail-title" onCancel={event => { event.preventDefault(); if (lightboxIndex !== null) setLightboxIndex(null); else onClose(); }}>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="admin-job-header">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge value={job.status} />
              <span className="text-xs font-bold text-slate-500">第 {index + 1} / {total} 项</span>
            </div>
            <h3 id="job-detail-title" className="line-clamp-1 text-base font-semibold text-slate-950">任务详情</h3>
            <p className="mt-1 break-all text-xs text-slate-500">{job.id}</p>
          </div>
          <div className="flex gap-2">
            <button className="admin-icon-button" disabled={!onPrev} onClick={onPrev} title="上一项" aria-label="上一项">
              <ArrowLeft size={17} aria-hidden />
            </button>
            <button className="admin-icon-button" disabled={!onNext} onClick={onNext} title="下一项" aria-label="下一项">
              <ArrowRight size={17} aria-hidden />
            </button>
            <button className="admin-icon-button" onClick={onClose} title="关闭" aria-label="关闭">
              <XCircle size={18} aria-hidden />
            </button>
          </div>
        </header>
        <div className="admin-job-tabs" role="tablist" aria-label="任务详情视图">
          <button id="job-result-tab" role="tab" aria-selected={detailTab === 'result'} aria-controls="job-detail-content" onClick={() => setDetailTab('result')}>用户需求与结果</button>
          <button id="job-system-tab" role="tab" aria-selected={detailTab === 'system'} aria-controls="job-detail-content" onClick={() => setDetailTab('system')}>系统处理记录</button>
        </div>
        <div id="job-detail-content" role="tabpanel" aria-labelledby={detailTab === 'result' ? 'job-result-tab' : 'job-system-tab'} className="admin-job-body">
          <aside className="admin-job-sidebar">
            <h4 className="admin-job-section-title"><FileImage size={16} aria-hidden />任务信息</h4>
            <div className="admin-job-metadata">
              <UserDetailLine label="用户 ID" value={job.userId ?? '匿名用户'} mono />
              <UserDetailLine label="模型" value={`${labelFor(job.selectedProvider)} / ${job.selectedModel}`} />
              <UserDetailLine label="渠道路由" value={(job.providerRoute?.length ?? 0) > 1 ? job.providerRoute!.map(item => `${labelFor(item.provider)}（${item.reason === 'fallback' ? '备用' : '主渠道'}）`).join(' → ') : '主渠道未发生回退'} />
              <UserDetailLine label="模式" value={job.mode === 'edit' ? '编辑图片' : '生成图片'} />
              <UserDetailLine label="识别意图" value={job.template} />
              <UserDetailLine label="比例 / 清晰度" value={`${job.aspectRatio} / ${job.quality}`} />
              <UserDetailLine label="扣除积分" value={job.paymentMode === 'credits' ? job.creditsReserved : 0} />
              <UserDetailLine label="确认积分" value={job.confirmedCredits ?? '-'} />
              <UserDetailLine label="执行次数" value={job.attempt ?? 0} />
              <UserDetailLine label="支付方式" value={job.paymentMode ?? '免费'} />
              <UserDetailLine label="创建 / 完成" value={`${formatDate(job.createdAt)} / ${formatDate(job.completedAt)}`} />
            </div>
            <div className="admin-job-notes">
              <JsonBlock title={detailTab === 'result' ? '用户需求' : '最终发送给模型的提示词'} value={detailTab === 'result' ? job.prompt : job.finalPrompt} />
              {detailTab === 'system' && <JsonBlock title="操作与位置评论" value={{ operation: job.previewOperation, comments: job.editComments, selection: job.quotedSelection }} />}
              {job.error && <JsonBlock title="错误信息" value={job.error} />}
            </div>
          </aside>
          <section className="admin-job-media">
            {detailTab === 'system' ? <ImageGallery title="模型输入材料" empty="暂无输入材料" images={galleryImages.slice(0, inputCount)} onOpen={setLightboxIndex} /> : <>
              <ImageGallery title="生成结果" empty="暂无结果图" images={galleryImages.slice(inputCount)} onOpen={imageIndex => setLightboxIndex(inputCount + imageIndex)} />
              {!job.previewOperation && <ImageGallery title="用户参考图" empty="暂无参考图" images={galleryImages.slice(0, job.inputFiles.length)} onOpen={setLightboxIndex} />}
            </>}
          </section>
        </div>
      </section>
      {lightboxIndex !== null && lightboxImage && (
        <ImageLightbox
          image={lightboxImage}
          index={lightboxIndex}
          total={galleryImages.length}
          onClose={() => setLightboxIndex(null)}
          onPrev={lightboxIndex > 0 ? () => setLightboxIndex(lightboxIndex - 1) : undefined}
          onNext={lightboxIndex < galleryImages.length - 1 ? () => setLightboxIndex(lightboxIndex + 1) : undefined}
        />
      )}
    </dialog>
  );
}

function ImageGallery({
  title,
  empty,
  images,
  onOpen
}: {
  title: string;
  empty: string;
  images: Array<{ url: string; label: string; meta?: string }>;
  onOpen: (index: number) => void;
}) {
  return (
    <div className="admin-image-gallery">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-black text-slate-950">{title}</h4>
        <span className="text-xs font-bold text-slate-500">{images.length} 张</span>
      </div>
      {images.length === 0 ? (
        <div className="admin-image-empty"><FileImage size={30} aria-hidden /><span>{empty}</span></div>
      ) : (
        <div className="admin-image-grid">
          {images.map((image, imageIndex) => (
            <button
              key={`${image.url}:${imageIndex}`}
              type="button"
              onClick={() => onOpen(imageIndex)}
              className="admin-image-tile group"
            >
              <img src={image.url} alt={image.label} className="aspect-square w-full object-contain transition-transform group-hover:scale-105" />
              <p className="border-t border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">{image.label}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageLightbox({
  image,
  index,
  total,
  onClose,
  onPrev,
  onNext
}: {
  image: { url: string; label: string; meta?: string };
  index: number;
  total: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/85 p-4" role="dialog" aria-modal="true" aria-label="图片预览">
      <button className="absolute inset-0 cursor-default" type="button" onClick={onClose} aria-label="关闭图片预览" />
      <div className="relative flex max-h-full w-full max-w-5xl flex-col">
        <div className="mb-3 flex items-center justify-between gap-3 text-white">
          <div>
            <p className="text-sm font-black">{image.label}</p>
            <p className="text-xs text-slate-300">第 {index + 1} / {total} 张{image.meta ? ` · ${image.meta}` : ''}</p>
          </div>
          <div className="flex gap-2">
            <button className="admin-icon-button" disabled={!onPrev} onClick={onPrev} title="上一张" aria-label="上一张">
              <ArrowLeft size={17} aria-hidden />
            </button>
            <button className="admin-icon-button" disabled={!onNext} onClick={onNext} title="下一张" aria-label="下一张">
              <ArrowRight size={17} aria-hidden />
            </button>
            <button className="admin-icon-button" onClick={onClose} title="关闭" aria-label="关闭">
              <XCircle size={18} aria-hidden />
            </button>
          </div>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/30">
          <img src={image.url} alt={image.label} className="max-h-[76dvh] w-auto max-w-full object-contain" />
        </div>
      </div>
    </div>
  );
}

function ModelsTab() {
  return <AiConfigPanel />;
}


function AuditTab() {
  const [query, setQuery] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: '100' });
    if (query.trim()) value.set('action', query.trim());
    if (cursors.length) value.set('cursor', cursors[cursors.length - 1]);
    return value;
  }, [cursors, query]);
  const logsQuery = useQuery({
    queryKey: ['admin', 'audit', params.toString()],
    queryFn: () => listAdminAuditLogs(params),
    refetchInterval: 30000
  });
  const logs = logsQuery.data?.logs ?? [];
  const nextCursor = logsQuery.data?.nextCursor;

  return (
    <Panel title="操作记录" flat>
      <Toolbar>
        <SearchBox value={query} onChange={(value) => { setQuery(value); setCursors([]); }} placeholder="按操作类型搜索" label="搜索操作记录" />
        <RefreshButton busy={logsQuery.isFetching} onClick={() => void logsQuery.refetch()} />
      </Toolbar>
      {logsQuery.isError && <p className="admin-inline-error" role="alert">操作记录加载失败，请刷新重试。</p>}
      <div className="grid gap-2">
        {logs.map((log) => <AuditRow key={log.id} log={log} />)}
        {logsQuery.isPending ? <EmptyLine text="正在加载操作记录…" /> : !logsQuery.isError && logs.length === 0 && <EmptyLine text="暂无操作记录" />}
      </div>
      <nav className="admin-pagination" aria-label="操作记录分页">
        <span>第 {cursors.length + 1} 页</span>
        <button className="admin-icon-button" title="上一页" aria-label="上一页" disabled={!cursors.length || logsQuery.isPending} onClick={() => setCursors((value) => value.slice(0, -1))}><ChevronLeft size={17} /></button>
        <button className="admin-icon-button" title="下一页" aria-label="下一页" disabled={!nextCursor || logsQuery.isPending} onClick={() => { if (nextCursor) setCursors((value) => [...value, nextCursor]); }}><ChevronRight size={17} /></button>
      </nav>
    </Panel>
  );
}

function AuditRow({ log }: { log: AdminAuditLogRecord }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer list-none">
        <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
          <p className="text-xs font-bold text-slate-500">{formatDate(log.createdAt)}</p>
          <p className="truncate text-sm font-black">{labelFor(log.action)}</p>
          <p className="truncate text-sm text-slate-500">{log.target}</p>
        </div>
      </summary>
      <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 lg:grid-cols-2">
        <JsonBlock title="变更前" value={log.before} />
        <JsonBlock title="变更后" value={log.after} />
      </div>
    </details>
  );
}

function JobMiniList({ jobs }: { jobs: ImageJobRecord[] }) {
  if (jobs.length === 0) return <EmptyLine text="暂无失败任务" />;
  return (
    <div className="admin-failure-list">
      {jobs.map((job) => (
        <div key={job.id}>
          <span><AlertTriangle size={16} aria-hidden /></span>
          <div><strong>{job.prompt || '图片任务'}</strong><small>{job.error?.message ?? job.id}</small></div>
          <time>{formatDate(job.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}

function percentOf(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function DashboardMetric({
  label,
  value,
  sub,
  tone = 'default'
}: {
  label: string;
  value?: number | string;
  sub: string;
  tone?: 'default' | 'accent' | 'warning' | 'danger';
}) {
  return (
    <div className="admin-metric" data-tone={tone}>
      <p>{label}</p>
      <strong>{value ?? '-'}</strong>
      <small>{sub}</small>
    </div>
  );
}

function ModelUsageChart({ models }: { models: AdminOverviewResponse['models'] }) {
  const rows = [...models].sort((left, right) => right.jobs - left.jobs).slice(0, 8);
  const maxJobs = Math.max(1, ...rows.map((model) => model.jobs));
  if (rows.length === 0) return <EmptyLine text="当前范围内暂无模型调用" />;
  return (
    <div className="admin-model-table-wrap">
      <table className="admin-model-table" aria-label="模型调用表现">
        <thead><tr><th>模型</th><th>调用量</th><th>成功率</th><th>失败</th></tr></thead>
        <tbody>{rows.map((model) => {
          const completed = model.succeeded + model.failed;
          const successRate = completed ? `${percentOf(model.succeeded, completed)}%` : '-';
          return (
            <tr key={`${model.provider}:${model.model}`}>
              <td><span><strong title={model.model}>{model.model}</strong><small>{labelFor(model.provider)}</small></span></td>
              <td><div className="admin-model-volume"><span aria-label={`${model.jobs} 次调用`}><i style={{ width: `${(model.jobs / maxJobs) * 100}%` }} /></span><strong>{model.jobs}</strong></div></td>
              <td><strong>{successRate}</strong></td>
              <td><strong className={model.failed ? 'is-error' : ''}>{model.failed}</strong></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function Panel({ title, action, children, flat = false }: { title: string; action?: React.ReactNode; children: React.ReactNode; flat?: boolean }) {
  return (
    <section className={flat ? 'admin-list' : 'admin-panel'} aria-label={title}>
      <div className={flat ? 'sr-only' : 'admin-panel-header'}>
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="admin-toolbar">{children}</div>;
}

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="admin-segmented" role="group">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          className={value === optionValue ? 'is-active' : ''}
          onClick={() => onChange(optionValue)}
          aria-pressed={value === optionValue}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function AdminSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="admin-select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
      <ChevronDown size={15} aria-hidden />
    </label>
  );
}

function SearchBox({ value, onChange, placeholder, label = placeholder }: { value: string; onChange: (value: string) => void; placeholder: string; label?: string }) {
  return (
    <label className="admin-search-box">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden />
      <input
        className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold outline-none focus:border-teal-600"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`admin-badge ${statusTone(value)}`}>{labelFor(value)}</span>;
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-bold uppercase text-slate-500">{title}</p>
      <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-50">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-500">{text}</div>;
}

function CenteredState({ icon, title, detail, action }: { icon: React.ReactNode; title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <main className="admin-centered-state">
      <div>
        <span>{icon}</span>
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
        {action && <footer>{action}</footer>}
      </div>
    </main>
  );
}
