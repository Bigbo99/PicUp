'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  ClipboardList,
  FileImage,
  Gauge,
  Home,
  Infinity,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
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
  ImageJobStatus,
  ModelConfig,
  ModelsResponse
} from '@picup/shared';
import { getMe, getModels, logout } from '@/lib/api';
import {
  deleteAdminUser,
  getAdminOverview,
  getAdminProviderHealth,
  listAdminAuditLogs,
  listAdminJobs,
  listAdminSettings,
  listAdminUsers,
  updateAdminModel,
  updateAdminUserCredits,
  updateAdminUserQuota,
  updateAdminUserStatus,
  upsertAdminSetting
} from '@/lib/admin-api';
import { useNotifications } from '@/components/notification-provider';

type AdminTab = 'overview' | 'users' | 'jobs' | 'models' | 'settings' | 'audit';

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
    tokenrun: 'TokenRun',
    'user.quota_unlimited.update': '更新用户无限额度',
    'user.status.update': '更新用户状态',
    'user.credits.adjust': '调整用户额度',
    'user.delete': '删除用户',
    'model_config.update': '更新模型配置',
    'app_setting.upsert': '保存功能设置'
  };
  return labels[value] ?? value;
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
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
    <main className="min-h-screen bg-[#eef3f1] text-slate-950">
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col lg:flex-row">
        <aside className="border-b border-slate-200 bg-white/90 px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 lg:block">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">PicUp Admin</p>
              <h1 className="mt-1 text-2xl font-black tracking-normal">运营控制台</h1>
            </div>
            <Link className="admin-icon-button lg:hidden" href="/" title="返回工作台" aria-label="返回工作台">
              <Home size={18} aria-hidden />
            </Link>
          </div>

          <nav className="mt-5 flex gap-2 overflow-x-auto lg:grid lg:gap-1.5 lg:overflow-visible">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-bold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-slate-950 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="mt-6 hidden rounded-lg border border-slate-200 bg-slate-50 p-3 lg:block">
            <p className="text-xs font-bold text-slate-500">当前管理员</p>
            <p className="mt-1 truncate text-sm font-black">{user.displayName || user.email || user.id}</p>
            <div className="mt-3 flex gap-2">
              <Link className="admin-icon-button" href="/" title="返回工作台" aria-label="返回工作台">
                <Home size={17} aria-hidden />
              </Link>
              <button className="admin-secondary-button min-h-10 flex-1" onClick={() => logoutMutation.mutate()}>
                退出
              </button>
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1 px-4 py-5 lg:px-6">
          <header className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-bold text-teal-700">{tabs.find((tab) => tab.id === activeTab)?.label}</p>
              <h2 className="mt-1 text-3xl font-black tracking-normal">后台管理</h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
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

  return (
    <div className="grid gap-4">
      <Toolbar>
        <Segmented value={range} onChange={setRange} options={[['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['all', '全部']]} />
      </Toolbar>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={<Users size={20} />} label="用户总数" value={overview?.totals.users} sub={`${overview?.totals.registeredUsers ?? 0} 注册 / ${overview?.totals.guests ?? 0} 游客`} />
        <MetricCard icon={<ShieldCheck size={20} />} label="用户状态" value={overview?.totals.activeUsers} sub={`${overview?.totals.disabledUsers ?? 0} 禁用 / ${overview?.totals.pendingUsers ?? 0} 待处理 / ${overview?.totals.admins ?? 0} 管理员`} />
        <MetricCard icon={<FileImage size={20} />} label="文件总数" value={overview?.totals.files} sub="上传与结果文件" />
        <MetricCard icon={<Activity size={20} />} label="任务总数" value={overview?.totals.jobs} sub={`${overview?.jobs.rangeCreated ?? 0} 个在当前范围创建`} />
        <MetricCard icon={<Gauge size={20} />} label="成功率" value={`${overview?.jobs.successRate ?? 0}%`} sub={`${overview?.jobs.succeeded ?? 0} 成功 / ${overview?.jobs.failed ?? 0} 失败`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title="任务状态">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['queued', 'running', 'retrying', 'succeeded', 'failed', 'refunded'] as ImageJobStatus[]).map((status) => (
              <div key={status} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-bold text-slate-500">{labelFor(status)}</p>
                <p className="mt-2 text-2xl font-black">{overview?.jobs[status] ?? 0}</p>
              </div>
            ))}
          </div>
        </Panel>
        <ProviderPanel data={providersQuery.data} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="模型使用分布">
          <div className="grid gap-2">
            {(overview?.models ?? []).slice(0, 8).map((model) => (
              <div key={`${model.provider}:${model.model}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">{model.model}</p>
                  <p className="text-xs font-bold text-slate-500">{labelFor(model.provider)}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black">{model.jobs}</p>
                  <p className="text-xs text-slate-500">{model.succeeded} 成功 / {model.failed} 失败</p>
                </div>
              </div>
            ))}
            {overview?.models.length === 0 && <EmptyLine text="当前范围内暂无模型调用" />}
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
  const quotaMutation = useMutation({
    mutationFn: ({ id, quotaUnlimited }: { id: string; quotaUnlimited: boolean }) => updateAdminUserQuota(id, quotaUnlimited),
    onSuccess: () => {
      notifications.success('用户额度已更新');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (error) => notifications.error('更新失败', error instanceof Error ? error.message : '请稍后重试')
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AuthUser['status'] }) => updateAdminUserStatus(id, status, 'admin_console'),
    onSuccess: () => {
      notifications.success('用户状态已更新');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => notifications.error('更新失败', error instanceof Error ? error.message : '请稍后重试')
  });
  const creditMutation = useMutation({
    mutationFn: ({ id, delta }: { id: string; delta: number }) => updateAdminUserCredits(id, delta, 'admin_console_adjustment'),
    onSuccess: () => {
      notifications.success('积分已调整');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => notifications.error('调整失败', error instanceof Error ? error.message : '请稍后重试')
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
          busy={creditMutation.isPending || quotaMutation.isPending || statusMutation.isPending}
          onClose={() => setSettingsUserId(null)}
          onAdjustCredits={(delta) => creditMutation.mutate({ id: settingsUser.id, delta })}
          onToggleQuota={() => quotaMutation.mutate({ id: settingsUser.id, quotaUnlimited: !settingsUser.quotaUnlimited })}
          onSetStatus={(nextStatus) => statusMutation.mutate({ id: settingsUser.id, status: nextStatus })}
        />
      )}
    </Panel>
  );
}

function UserSettingsDialog({
  user,
  busy,
  onClose,
  onAdjustCredits,
  onToggleQuota,
  onSetStatus
}: {
  user: AuthUser;
  busy: boolean;
  onClose: () => void;
  onAdjustCredits: (delta: number) => void;
  onToggleQuota: () => void;
  onSetStatus: (status: AuthUser['status']) => void;
}) {
  const [creditDelta, setCreditDelta] = useState('10');
  const title = user.displayName || user.email || user.id;
  const canAdjust = Number.isInteger(Number(creditDelta)) && Number(creditDelta) !== 0;

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
                <UserDetailLine label="邮箱" value={user.email ?? '-'} />
                <UserDetailLine label="显示名称" value={user.displayName ?? '-'} />
                <UserDetailLine label="角色" value={<Badge value={user.role} />} />
                <UserDetailLine label="状态" value={<Badge value={user.status} />} />
                <UserDetailLine label="账号类型" value={user.isGuest ? '游客' : '注册用户'} />
                <UserDetailLine label="邮箱验证" value={user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : '未验证'} />
                <UserDetailLine label="创建时间" value={formatDate(user.createdAt)} />
                <UserDetailLine label="更新时间" value={formatDate(user.updatedAt)} />
              </div>
            </section>

            <div className="grid gap-4">
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <Infinity size={20} aria-hidden />
                  </div>
                  <div>
                    <h4 className="font-black text-slate-950">额度设置</h4>
                    <p className="text-sm text-slate-500">余额和无限额度管理</p>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-black uppercase text-slate-500">当前余额</p>
                  <p className="mt-1 text-3xl font-black text-slate-950">{user.quotaUnlimited ? '无限' : user.creditBalance}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm font-bold outline-none focus:border-teal-600"
                    value={creditDelta}
                    onChange={(event) => setCreditDelta(event.target.value)}
                    placeholder="输入增减额度"
                  />
                  <button
                    className="admin-secondary-button"
                    disabled={busy || !canAdjust}
                    onClick={() => onAdjustCredits(Number(creditDelta))}
                  >
                    <Plus size={15} aria-hidden />
                    调整额度
                  </button>
                </div>
                <button className="admin-secondary-button mt-3 w-full" disabled={busy} onClick={onToggleQuota}>
                  <Infinity size={15} aria-hidden />
                  {user.quotaUnlimited ? '取消无限额度' : '设为无限额度'}
                </button>
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
                <div className="grid grid-cols-3 gap-2">
                  {(['active', 'pending', 'disabled'] as AuthUser['status'][]).map((nextStatus) => (
                    <button
                      key={nextStatus}
                      className={`min-h-10 rounded-lg border px-3 text-sm font-black transition-colors ${
                        user.status === nextStatus ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-600 hover:text-teal-700'
                      }`}
                      disabled={busy || user.status === nextStatus}
                      onClick={() => onSetStatus(nextStatus)}
                    >
                      {labelFor(nextStatus)}
                    </button>
                  ))}
                </div>
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
  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: '50' });
    if (status) value.set('status', status);
    return value;
  }, [status]);
  const jobsQuery = useQuery({
    queryKey: ['admin', 'jobs', params.toString()],
    queryFn: () => listAdminJobs(params),
    refetchInterval: 10000
  });
  const jobs = jobsFromResponse(jobsQuery.data);

  return (
    <Panel title="任务监控">
      <Toolbar>
        <Segmented value={status} onChange={setStatus} options={[['', '全部'], ['queued', '排队'], ['running', '运行'], ['succeeded', '成功'], ['failed', '失败']]} />
      </Toolbar>
      <div className="grid gap-3">
        {jobs.map((job) => <JobRow key={job.id} job={job} />)}
        {jobs.length === 0 && <EmptyLine text="暂无任务" />}
      </div>
    </Panel>
  );
}

function JobRow({ job }: { job: ImageJobRecord }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer list-none">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_140px_110px] md:items-center">
          <div className="min-w-0">
            <p className="truncate text-sm font-black">{job.prompt}</p>
            <p className="mt-1 text-xs text-slate-500">{job.id} / {job.userId ?? '匿名用户'}</p>
          </div>
          <Badge value={job.status} />
          <p className="text-sm font-bold">{labelFor(job.selectedProvider)} / {job.selectedModel}</p>
          <p className="text-xs text-slate-500">{formatDate(job.createdAt)}</p>
        </div>
      </summary>
      <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 text-sm md:grid-cols-2">
        <JsonBlock title="最终提示词" value={job.finalPrompt} />
        <JsonBlock title="错误信息" value={job.error ?? '无'} />
      </div>
    </details>
  );
}

function ModelsTab() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const modelsQuery = useQuery({ queryKey: ['admin', 'models'], queryFn: getModels });
  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ModelConfig> }) => updateAdminModel(id, patch),
    onSuccess: () => {
      notifications.success('模型配置已保存');
      queryClient.invalidateQueries({ queryKey: ['admin', 'models'] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (error) => notifications.error('保存失败', error instanceof Error ? error.message : '请稍后重试')
  });
  const models = (modelsQuery.data as ModelsResponse | undefined)?.models ?? [];

  return (
    <Panel title="模型配置">
      <div className="grid gap-3">
        {models.map((model) => (
          <article key={model.id ?? `${model.provider}:${model.model}`} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-black">{model.displayName}</h3>
                  <Badge value={model.provider} />
                  <Badge value={model.enabled ? 'enabled' : 'disabled'} />
                </div>
                <p className="mt-1 break-all text-sm text-slate-500">{model.model}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{model.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="优先级" value={model.priority ?? 100} onSave={(priority) => model.id && updateMutation.mutate({ id: model.id, patch: { priority } })} />
                <NumberField label="单次额度消耗" value={model.costCredits} onSave={(costCredits) => {
                  if (model.id && window.confirm(`确认把 ${model.displayName} 单次消耗改为 ${costCredits}？`)) {
                    updateMutation.mutate({ id: model.id, patch: { costCredits } });
                  }
                }} />
                <NumberField label="输入图上限" value={model.maxInputImages} onSave={(maxInputImages) => model.id && updateMutation.mutate({ id: model.id, patch: { maxInputImages } })} />
                <button
                  className="admin-secondary-button min-h-10"
                  onClick={() => {
                    if (!model.id) return;
                    const enabled = !model.enabled;
                    if (enabled || window.confirm(`确认关闭 ${model.displayName}？前台将不可选择该模型。`)) {
                      updateMutation.mutate({ id: model.id, patch: { enabled } });
                    }
                  }}
                >
                  {model.enabled ? '关闭模型' : '启用模型'}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
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

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value?: number | string; sub: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-black">{value ?? '-'}</p>
        </div>
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-700">{icon}</div>
      </div>
      <p className="mt-3 text-xs font-medium text-slate-500">{sub}</p>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white/70 p-3 shadow-sm">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-black">{title}</h3>
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

function NumberField({ label, value, onSave }: { label: string; value: number; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <label className="grid gap-1">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <span className="flex gap-1">
        <input
          className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-sm font-bold outline-none focus:border-teal-600"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="admin-icon-button" onClick={() => {
          const next = Number(draft);
          if (Number.isInteger(next) && next >= 0) onSave(next);
        }} title="保存" aria-label="保存">
          <Save size={15} aria-hidden />
        </button>
      </span>
    </label>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-black ${statusTone(value)}`}>{value}</span>;
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
