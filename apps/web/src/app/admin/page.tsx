'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  ClipboardList,
  Database,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileImage,
  Gauge,
  Globe2,
  Home,
  Infinity as InfinityIcon,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Trash2,
  Users,
  Wand2,
  XCircle
} from 'lucide-react';
import type {
  AdminAppSettingRecord,
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
  listAdminSettings,
  listAdminUsers,
  updateAdminUser,
  updateAdminUserStatus,
  upsertAdminSetting
} from '@/lib/admin-api';
import { useNotifications } from '@/components/notification-provider';
import { AiConfigPanel } from '@/components/admin/ai-config-panel';

type AdminTab = 'overview' | 'users' | 'jobs' | 'models' | 'settings' | 'audit';
type AdminUserDraft = Parameters<typeof updateAdminUser>[1];

const tabs: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: '数据监控', icon: <BarChart3 size={17} aria-hidden /> },
  { id: 'users', label: '用户管理', icon: <Users size={17} aria-hidden /> },
  { id: 'jobs', label: '任务监控', icon: <ClipboardList size={17} aria-hidden /> },
  { id: 'models', label: '模型配置', icon: <SlidersHorizontal size={17} aria-hidden /> },
  { id: 'settings', label: '功能设置', icon: <Settings size={17} aria-hidden /> },
  { id: 'audit', label: '审计日志', icon: <ShieldCheck size={17} aria-hidden /> }
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
  if (['active', 'succeeded', 'healthy', 'enabled', 'paid'].includes(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (['running', 'queued', 'retrying', 'degraded', 'pending'].includes(status)) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (['failed', 'disabled', 'closed'].includes(status)) return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const meQuery = useQuery({ queryKey: ['me'], queryFn: getMe });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login?next=/admin';
    }
  });

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
    <main className="min-h-screen bg-[#f4f7f5] text-[#083b2d]">
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col lg:flex-row">
        <aside className={`grid border-b border-emerald-950/10 bg-white/95 px-4 py-3 shadow-sm transition-all lg:sticky lg:top-0 lg:h-screen lg:flex lg:flex-col lg:px-4 lg:py-4 lg:border-b-0 lg:border-r ${sidebarCollapsed ? 'lg:w-24' : 'lg:w-72'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className={`flex min-w-0 items-center gap-3 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 sm:h-11 sm:w-11">
                <Wand2 size={20} aria-hidden />
              </span>
              <div className={`min-w-0 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                <p className="text-[11px] font-black uppercase leading-none tracking-[0.18em] text-emerald-700">PicUp Admin</p>
                <h1 className="mt-1 truncate text-lg font-black tracking-normal sm:text-xl">后台</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <span className="max-w-28 truncate rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800">
                {user.isSuperAdmin ? '超级管理员' : '管理员'}
              </span>
              <Link className="admin-icon-button" href="/" title="返回工作台" aria-label="返回工作台">
                <Home size={18} aria-hidden />
              </Link>
            </div>
          </div>

          <nav className="admin-mobile-tabs -mx-4 mt-3 flex gap-2 overflow-x-auto border-t border-emerald-950/10 px-4 pt-3 [scrollbar-width:none] lg:mx-0 lg:mt-6 lg:grid lg:gap-4 lg:overflow-visible lg:border-t-0 lg:px-0 lg:pt-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg text-sm font-black transition-colors sm:h-11 ${sidebarCollapsed ? 'lg:w-11 lg:justify-center lg:px-0' : 'px-3'} ${
                  activeTab === tab.id
                    ? 'bg-emerald-50 text-emerald-800 shadow-[inset_3px_0_0_#059669]'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-emerald-800'
                }`}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{tab.icon}</span>
                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className={`mt-auto hidden pt-6 lg:grid ${sidebarCollapsed ? 'justify-items-center gap-3' : 'gap-3'}`}>
            <button
              className="admin-icon-button"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
              aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            >
              {sidebarCollapsed ? <ChevronRight size={17} aria-hidden /> : <ChevronLeft size={17} aria-hidden />}
            </button>
            {sidebarCollapsed ? (
              <>
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-sm font-black text-emerald-800" title={user.displayName || user.email || user.id}>
                  {(user.displayName || user.email || user.id).slice(0, 1).toUpperCase()}
                </div>
                <Link className="admin-icon-button" href="/" title="返回工作台" aria-label="返回工作台">
                  <Home size={17} aria-hidden />
                </Link>
                <button className="admin-icon-button" onClick={() => logoutMutation.mutate()} title="退出" aria-label="退出">
                  <ArrowLeft size={17} aria-hidden />
                </button>
              </>
            ) : (
              <div className="rounded-lg border border-emerald-950/10 bg-white p-4 shadow-sm">
                <p className="text-xs font-bold text-slate-500">当前管理员</p>
                <p className="mt-2 truncate text-lg font-black text-[#083b2d]">{user.displayName || user.email || user.id}</p>
                <p className="mt-1 text-sm font-black text-emerald-700">{user.isSuperAdmin ? '超级管理员' : '管理员'}</p>
                <div className="mt-5 grid grid-cols-[60px_minmax(0,1fr)] gap-3">
                  <Link className="admin-icon-button h-[60px] w-[60px]" href="/" title="返回工作台" aria-label="返回工作台">
                    <Home size={21} aria-hidden />
                  </Link>
                  <button className="admin-secondary-button min-h-[60px] text-lg" onClick={() => logoutMutation.mutate()}>
                    退出
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="min-w-0 flex-1 px-4 py-4 lg:px-7 lg:py-5">
          <header className="mb-4 flex flex-row items-end justify-between gap-3 border-b border-emerald-950/10 pb-4">
            <div>
              <p className="text-xs font-black text-emerald-700 sm:text-sm">{activeTab === 'overview' ? 'Dashboard' : 'Management'}</p>
              <h2 className="mt-1 text-2xl font-black tracking-normal sm:text-3xl">{activeTab === 'overview' ? '数据看板' : tabs.find((tab) => tab.id === activeTab)?.label}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-sm text-slate-500">
              <span className="hidden rounded-lg border border-emerald-950/10 bg-white px-3 py-2 text-xs font-bold text-slate-500 md:inline-flex">
                自动刷新 30 秒
              </span>
              <button className="admin-icon-button" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin'] })} title="刷新" aria-label="刷新">
                <RefreshCw size={17} aria-hidden />
              </button>
            </div>
          </header>

          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'jobs' && <JobsTab />}
          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'settings' && <SettingsTab />}
          {activeTab === 'audit' && <AuditTab />}
        </section>
      </div>
    </main>
  );
}

function OverviewTab() {
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
  const completed = (overview?.jobs.succeeded ?? 0) + (overview?.jobs.failed ?? 0);
  const activeJobs = (overview?.jobs.queued ?? 0) + (overview?.jobs.running ?? 0) + (overview?.jobs.retrying ?? 0);
  const statusRows = (['queued', 'running', 'retrying', 'succeeded', 'failed', 'refunded'] as ImageJobStatus[]).map((status) => ({
    status,
    value: overview?.jobs[status] ?? 0
  }));

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Segmented value={range} onChange={setRange} options={[['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['all', '全部']]} />
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <DashboardMetric icon={<Users size={18} />} label="用户总数" value={overview?.totals.users} sub={`${overview?.totals.registeredUsers ?? 0} 注册 / ${overview?.totals.guests ?? 0} 游客`} trend={`活跃 ${overview?.totals.activeUsers ?? 0}`} />
        <DashboardMetric icon={<ClipboardList size={18} />} label="任务总数" value={overview?.totals.jobs} sub={`当前范围新增 ${overview?.jobs.rangeCreated ?? 0}`} trend={`处理中 ${activeJobs}`} tone="blue" />
        <DashboardMetric icon={<Gauge size={18} />} label="任务成功率" value={`${overview?.jobs.successRate ?? 0}%`} sub={`${completed} 个已完成任务`} trend={`${overview?.jobs.succeeded ?? 0} 成功`} tone="emerald" />
        <DashboardMetric icon={<Globe2 size={18} />} label="游客来源" value={overview?.guestGeo.length ?? 0} sub="基于游客 IP 记录" trend={`${overview?.totals.guests ?? 0} 游客`} tone="cyan" />
        <DashboardMetric icon={<Database size={18} />} label="素材与审计" value={overview?.totals.files} sub={`${overview?.totals.auditLogs ?? 0} 条审计日志`} trend={`${overview?.totals.settings ?? 0} 项设置`} tone="amber" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <Panel
          title="模型调用表现"
          action={
            <div className="flex items-center gap-3 text-xs font-bold text-slate-500">
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />成功</span>
              <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rose-500" />失败</span>
            </div>
          }
        >
          <ModelUsageChart models={overview?.models ?? []} />
        </Panel>
        <Panel title="任务状态分布">
          <StatusDonut rows={statusRows} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <GuestGeoPanel items={overview?.guestGeo ?? []} totalGuests={overview?.totals.guests ?? 0} />
        <ProviderPanel data={providersQuery.data} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Panel title="任务状态矩阵">
          <div className="grid gap-2 sm:grid-cols-3">
            {statusRows.map((row) => (
              <StatusTile key={row.status} status={row.status} value={row.value} />
            ))}
          </div>
        </Panel>
        <Panel title="最近失败任务">
          <JobMiniList jobs={overview?.recentFailures ?? []} />
        </Panel>
      </div>
    </div>
  );
}

function ProviderPanel({ data }: { data?: AdminProviderHealthResponse }) {
  return (
    <Panel title="服务商健康">
      <div className="grid gap-2">
        {(data?.providers ?? []).map((provider) => (
          <div key={provider.provider} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black">{labelFor(provider.provider)}</p>
                <p className="mt-1 text-xs text-slate-500">启用模型 {provider.enabledModels} 个</p>
              </div>
              <Badge value={provider.status} />
            </div>
            {provider.message && <p className="mt-2 text-xs text-red-600">{provider.message}</p>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [isGuestFilter, setIsGuestFilter] = useState('');
  const [quotaFilter, setQuotaFilter] = useState('');
  const [settingsUserId, setSettingsUserId] = useState<string | null>(null);
  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: '50' });
    if (query.trim()) value.set('query', query.trim());
    if (role) value.set('role', role);
    if (status) value.set('status', status);
    if (isGuestFilter) value.set('isGuest', isGuestFilter);
    if (quotaFilter) value.set('quotaUnlimited', quotaFilter);
    return value;
  }, [isGuestFilter, query, quotaFilter, role, status]);
  const usersQuery = useQuery({ queryKey: ['admin', 'users', params.toString()], queryFn: () => listAdminUsers(params) });
  const users = usersFromResponse(usersQuery.data);
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
    <Panel title="用户管理" action={<SearchBox value={query} onChange={setQuery} placeholder="搜索邮箱、昵称或 ID" />}>
      <Toolbar>
        <Segmented value={role} onChange={setRole} options={[['', '全部'], ['guest', '游客'], ['user', '用户'], ['admin', '管理员']]} />
        <Segmented value={status} onChange={setStatus} options={[['', '全部状态'], ['active', '正常'], ['pending', '待定'], ['disabled', '禁用']]} />
        <Segmented value={isGuestFilter} onChange={setIsGuestFilter} options={[['', '全部身份'], ['true', '游客'], ['false', '注册']]} />
        <Segmented value={quotaFilter} onChange={setQuotaFilter} options={[['', '全部额度'], ['true', '无限'], ['false', '普通']]} />
      </Toolbar>
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
                  <p className="font-black">{user.displayName || user.email || '游客'}</p>
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
                  <div className="flex gap-2">
                    <button
                      className="admin-secondary-button min-h-9"
                      disabled={user.status === 'disabled'}
                      onClick={() => {
                        if (window.confirm('确认禁用该用户？')) statusMutation.mutate({ id: user.id, status: 'disabled' });
                      }}
                    >
                      禁用
                    </button>
                    <button
                      className="admin-secondary-button min-h-9 text-red-700 hover:border-red-200 hover:bg-red-50"
                      onClick={() => {
                        const label = user.email ?? user.displayName ?? user.id;
                        if (window.confirm(`确认删除用户 ${label}？该操作会保留历史任务和文件记录，但账号本身将被删除。`)) {
                          deleteMutation.mutate(user.id);
                        }
                      }}
                    >
                      <Trash2 size={14} aria-hidden />
                      删除
                    </button>
                    <button
                      className="admin-icon-button"
                      onClick={() => setSettingsUserId(user.id)}
                      title="用户设置"
                      aria-label={`打开 ${user.email ?? user.displayName ?? user.id} 的用户设置`}
                    >
                      <Settings size={16} aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const roleLocked = Boolean(user.isSuperAdmin);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="user-settings-title">
      <button className="absolute inset-0 cursor-default" type="button" onClick={onClose} aria-label="关闭用户设置" />
      <section className="relative max-h-[90dvh] w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <div className="mb-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">用户设置</div>
            <h3 id="user-settings-title" className="text-2xl font-black text-slate-950">{title}</h3>
            <p className="mt-1 max-w-xl break-all text-sm text-slate-500">{user.email ?? user.id}</p>
          </div>
          <button className="admin-icon-button" type="button" onClick={onClose} title="关闭" aria-label="关闭">
            <XCircle size={18} aria-hidden />
          </button>
        </header>

        <div className="max-h-[calc(90dvh-8rem)] overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white">
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
                  <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-teal-600" value={roleLocked ? 'admin' : role} disabled={roleLocked} onChange={(event) => setRole(event.target.value as Extract<AuthUser['role'], 'user' | 'admin'>)}>
                    <option value="user">用户</option>
                    <option value="admin">管理员</option>
                  </select>
                  {roleLocked && <span className="text-xs text-slate-500">超级管理员角色不可修改</span>}
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
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white">
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

              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
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
                    role,
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
    <div className="grid gap-1 rounded-lg border border-slate-200 bg-white p-3">
      <span className="text-xs font-black uppercase text-slate-500">{label}</span>
      <span className={`break-all text-sm font-bold text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</span>
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
    <Panel title="任务监控" action={<SearchBox value={userId} onChange={value => { setUserId(value); setCursors([]); }} placeholder="按用户 ID 筛选" />}>
      <Toolbar>
        <Segmented value={status} onChange={value => { setStatus(value); setCursors([]); }} options={[['', '全部'], ['queued', '排队'], ['running', '运行'], ['succeeded', '成功'], ['failed', '失败']]} />
        <button className="admin-icon-button" aria-label="刷新任务" title="刷新任务" disabled={jobsQuery.isFetching} onClick={() => void jobsQuery.refetch()}><RefreshCw size={17} /></button>
      </Toolbar>
      {jobsQuery.isError && <p role="alert">任务加载失败，请刷新重试。</p>}
      <div className="admin-table-wrap"><table className="admin-table admin-job-table"><thead><tr><th>任务 / 用户需求</th><th>状态</th><th>执行模型</th><th>积分</th><th>创建时间</th><th>详情</th></tr></thead><tbody>
        {jobs.map((job) => <JobRow key={job.id} job={job} onOpen={() => setActiveJobId(job.id)} />)}
      </tbody></table></div>
      {jobsQuery.isPending ? <EmptyLine text="正在加载任务…" /> : jobs.length === 0 && <EmptyLine text="暂无任务" />}
      <nav className="mt-3 flex items-center justify-end gap-3" aria-label="任务分页">
        <span className="text-xs text-slate-500">第 {cursors.length + 1} 页</span>
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
  return <tr><td><button className="admin-job-summary" onClick={onOpen}>{thumbnail ? <img src={thumbnail} alt="任务缩略图" /> : <FileImage size={24} />}<span><strong>{job.prompt || '图片编辑'}</strong><small>{job.id}</small></span></button></td><td><Badge value={job.status} /></td><td>{job.selectedModel}<small className="block text-slate-500">{job.previewOperation ? '系统自动匹配' : labelFor(job.selectedProvider)}</small></td><td>{job.paymentMode === 'credits' ? job.creditsReserved : 0}</td><td>{formatDate(job.createdAt)}</td><td><button className="admin-icon-button" aria-label={`查看任务 ${job.id}`} title="查看任务" onClick={onOpen}><ArrowRight size={18} /></button></td></tr>;
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
        <header className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
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
        <div id="job-detail-content" role="tabpanel" aria-labelledby={detailTab === 'result' ? 'job-result-tab' : 'job-system-tab'} className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[0.9fr_1.1fr]">
          <aside className="border-b border-slate-200 bg-slate-50 p-4 lg:border-b-0 lg:border-r">
            <div className="admin-job-metadata">
              <UserDetailLine label="用户 ID" value={job.userId ?? '匿名用户'} mono />
              <UserDetailLine label="模型" value={`${labelFor(job.selectedProvider)} / ${job.selectedModel}`} />
              <UserDetailLine label="模式" value={job.mode === 'edit' ? '编辑图片' : '生成图片'} />
              <UserDetailLine label="识别意图" value={job.template} />
              <UserDetailLine label="比例 / 清晰度" value={`${job.aspectRatio} / ${job.quality}`} />
              <UserDetailLine label="扣除积分" value={job.paymentMode === 'credits' ? job.creditsReserved : 0} />
              <UserDetailLine label="确认积分" value={job.confirmedCredits ?? '-'} />
              <UserDetailLine label="执行次数" value={job.attempt ?? 0} />
              <UserDetailLine label="支付方式" value={job.paymentMode ?? '免费'} />
              <UserDetailLine label="创建 / 完成" value={`${formatDate(job.createdAt)} / ${formatDate(job.completedAt)}`} />
            </div>
            <div className="mt-3 grid gap-3">
              <JsonBlock title={detailTab === 'result' ? '用户需求' : '最终发送给模型的提示词'} value={detailTab === 'result' ? job.prompt : job.finalPrompt} />
              {detailTab === 'system' && <JsonBlock title="操作与位置评论" value={{ operation: job.previewOperation, comments: job.editComments, selection: job.quotedSelection }} />}
              {job.error && <JsonBlock title="错误信息" value={job.error} />}
            </div>
          </aside>
          <section className="grid gap-4 p-4">
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
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-black text-slate-950">{title}</h4>
        <span className="text-xs font-bold text-slate-500">{images.length} 张</span>
      </div>
      {images.length === 0 ? (
        <EmptyLine text={empty} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {images.map((image, imageIndex) => (
            <button
              key={`${image.url}:${imageIndex}`}
              type="button"
              onClick={() => onOpen(imageIndex)}
              className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left"
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

function SettingsTab() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const settingsQuery = useQuery({ queryKey: ['admin', 'settings'], queryFn: listAdminSettings });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const settings = settingsQuery.data ?? [];
  const mutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: Record<string, unknown> }) => upsertAdminSetting(key, value),
    onSuccess: () => {
      notifications.success('设置已保存');
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (error) => notifications.error('保存失败', error instanceof Error ? error.message : '请检查 JSON 格式')
  });

  return (
    <Panel title="功能设置" action={<button className="admin-secondary-button" onClick={() => {
      const key = window.prompt('设置 key，例如 quota');
      if (key) setDrafts((value) => ({ ...value, [key]: '{\n  \n}' }));
    }}>新增设置</button>}>
      <div className="grid gap-3">
        {[...settings, ...Object.keys(drafts).filter((key) => !settings.some((item) => item.key === key)).map((key) => ({ key, value: {}, updatedBy: null, createdAt: '', updatedAt: '' } satisfies AdminAppSettingRecord))].map((setting) => {
          const draft = drafts[setting.key] ?? JSON.stringify(setting.value, null, 2);
          return (
            <article key={setting.key} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-black">{setting.key}</h3>
                  <p className="text-xs text-slate-500">更新于 {formatDate(setting.updatedAt)}</p>
                </div>
                <button className="admin-primary-button" onClick={() => {
                  try {
                    const value = JSON.parse(draft) as Record<string, unknown>;
                    if (window.confirm(`确认保存设置 ${setting.key}？`)) mutation.mutate({ key: setting.key, value });
                  } catch {
                    notifications.error('JSON 格式错误');
                  }
                }}>
                  <Save size={16} aria-hidden />
                  保存
                </button>
              </div>
              <textarea
                className="mt-3 min-h-44 w-full resize-y rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-sm leading-6 text-slate-50 outline-none focus:border-teal-500"
                value={draft}
                onChange={(event) => setDrafts((value) => ({ ...value, [setting.key]: event.target.value }))}
                spellCheck={false}
              />
            </article>
          );
        })}
        {settings.length === 0 && Object.keys(drafts).length === 0 && <EmptyLine text="暂无设置，可新增 quota、jobs、safety 或 maintenance" />}
      </div>
    </Panel>
  );
}

function AuditTab() {
  const [query, setQuery] = useState('');
  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: '100' });
    if (query.trim()) value.set('action', query.trim());
    return value;
  }, [query]);
  const logsQuery = useQuery({
    queryKey: ['admin', 'audit', params.toString()],
    queryFn: () => listAdminAuditLogs(params),
    refetchInterval: 30000
  });
  const logs = logsQuery.data?.logs ?? [];

  return (
    <Panel title="审计日志" action={<SearchBox value={query} onChange={setQuery} placeholder="按操作类型搜索" />}>
      <div className="grid gap-2">
        {logs.map((log) => <AuditRow key={log.id} log={log} />)}
        {logs.length === 0 && <EmptyLine text="暂无审计日志" />}
      </div>
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
    <div className="grid gap-2">
      {jobs.map((job) => (
        <div key={job.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="line-clamp-2 text-sm font-bold">{job.prompt}</p>
            <Badge value={job.status} />
          </div>
          <p className="mt-1 text-xs text-slate-500">{job.error?.message ?? job.id}</p>
        </div>
      ))}
    </div>
  );
}

function chartHeight(value: number, max: number) {
  if (value <= 0) return 8;
  return Math.max(18, Math.round((value / max) * 190));
}

function percentOf(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function statusColor(status: ImageJobStatus) {
  const colors: Record<ImageJobStatus, string> = {
    queued: '#60a5fa',
    running: '#22c55e',
    retrying: '#f59e0b',
    succeeded: '#10b981',
    failed: '#f43f5e',
    refunded: '#94a3b8'
  };
  return colors[status];
}

function DashboardMetric({
  icon,
  label,
  value,
  sub,
  trend,
  tone = 'emerald'
}: {
  icon: React.ReactNode;
  label: string;
  value?: number | string;
  sub: string;
  trend: string;
  tone?: 'emerald' | 'blue' | 'cyan' | 'amber';
}) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    cyan: 'bg-cyan-50 text-cyan-700',
    amber: 'bg-amber-50 text-amber-700'
  };
  return (
    <div className="rounded-lg border border-emerald-950/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-500">{label}</p>
          <p className="mt-2 truncate text-3xl font-black text-[#083b2d]">{value ?? '-'}</p>
        </div>
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-bold text-slate-500">{sub}</p>
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-black text-emerald-700">
          <TrendingUp size={13} aria-hidden />
          {trend}
        </span>
      </div>
    </div>
  );
}

function ModelUsageChart({ models }: { models: AdminOverviewResponse['models'] }) {
  const rows = models.slice(0, 8);
  const maxJobs = Math.max(1, ...rows.map((model) => model.jobs));
  if (rows.length === 0) return <EmptyLine text="当前范围内暂无模型调用" />;
  return (
    <div className="grid gap-4">
      <div className="flex min-h-72 items-end gap-4 overflow-x-auto border-b border-slate-100 px-1 pb-4 pt-8">
        {rows.map((model) => {
          const successHeight = chartHeight(model.succeeded, maxJobs);
          const failedHeight = chartHeight(model.failed, maxJobs);
          return (
            <div key={`${model.provider}:${model.model}`} className="flex min-w-20 flex-1 flex-col items-center gap-3">
              <div className="flex h-52 items-end gap-2">
                <div
                  className="w-4 rounded-t-md bg-emerald-500 shadow-sm"
                  style={{ height: `${successHeight}px` }}
                  title={`${model.model} 成功 ${model.succeeded}`}
                />
                <div
                  className="w-4 rounded-t-md bg-rose-400 shadow-sm"
                  style={{ height: `${failedHeight}px` }}
                  title={`${model.model} 失败 ${model.failed}`}
                />
              </div>
              <div className="w-full text-center">
                <p className="truncate text-xs font-black text-[#083b2d]" title={model.model}>{model.model}</p>
                <p className="mt-1 text-[11px] font-bold text-slate-400">{labelFor(model.provider)} · {model.jobs}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.slice(0, 4).map((model) => (
          <div key={`${model.provider}:${model.model}:summary`} className="rounded-lg bg-[#f7faf8] p-3">
            <p className="truncate text-xs font-black text-[#083b2d]">{model.model}</p>
            <p className="mt-1 text-xs text-slate-500">{model.succeeded} 成功 / {model.failed} 失败</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusDonut({ rows }: { rows: Array<{ status: ImageJobStatus; value: number }> }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  let cursor = 0;
  const gradient = total > 0
    ? rows
        .filter((row) => row.value > 0)
        .map((row) => {
          const start = cursor;
          const end = cursor + (row.value / total) * 360;
          cursor = end;
          return `${statusColor(row.status)} ${start}deg ${end}deg`;
        })
        .join(', ')
    : '#e2e8f0 0deg 360deg';

  return (
    <div className="grid gap-5 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
      <div className="relative mx-auto h-52 w-52 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="absolute inset-10 flex flex-col items-center justify-center rounded-full bg-white text-center shadow-inner">
          <p className="text-xs font-bold text-slate-500">任务总数</p>
          <p className="mt-1 text-3xl font-black text-[#083b2d]">{total}</p>
        </div>
      </div>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.status} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-[#f7faf8] p-3">
            <span className="inline-flex items-center gap-2 text-sm font-black text-[#083b2d]">
              <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusColor(row.status) }} />
              {labelFor(row.status)}
            </span>
            <span className="text-sm font-black text-slate-600">{row.value} · {percentOf(row.value, total)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuestGeoPanel({ items, totalGuests }: { items: AdminOverviewResponse['guestGeo']; totalGuests: number }) {
  const topItems = items.slice(0, 8);
  return (
    <Panel title="游客地域分析" action={<span className="text-xs font-bold text-slate-500">来源：游客 IP 记录</span>}>
      <div className="grid gap-2">
        {topItems.map((item) => {
          const percent = percentOf(item.guests, totalGuests);
          return (
            <div key={`${item.country}:${item.region ?? ''}:${item.city ?? ''}`} className="rounded-lg border border-slate-100 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-[#083b2d]">{formatGeo(item.country, item.region, item.city)}</p>
                  <p className="text-xs text-slate-500">最近访问 {formatDate(item.lastSeenAt ?? undefined)}</p>
                </div>
                <p className="text-sm font-black text-emerald-700">{percent}%</p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(percent, item.guests > 0 ? 4 : 0)}%` }} />
              </div>
              <p className="mt-1 text-xs font-bold text-slate-400">{item.guests} 位游客</p>
            </div>
          );
        })}
        {topItems.length === 0 && <EmptyLine text="暂无游客地域数据" />}
      </div>
    </Panel>
  );
}

function StatusTile({ status, value }: { status: ImageJobStatus; value: number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge value={status} />
        <Clock size={15} className="text-slate-400" aria-hidden />
      </div>
      <p className="mt-3 text-2xl font-black">{value}</p>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-emerald-950/10 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-black text-[#083b2d]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          className={`h-8 rounded-md px-3 text-sm font-bold transition-colors ${value === optionValue ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="relative block w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden />
      <input
        className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold outline-none focus:border-teal-600"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-black ${statusTone(value)}`}>{labelFor(value)}</span>;
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
    <main className="flex min-h-screen items-center justify-center bg-[#eef3f1] p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50 text-teal-700">{icon}</div>
        <h1 className="mt-4 text-2xl font-black">{title}</h1>
        {detail && <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </main>
  );
}
