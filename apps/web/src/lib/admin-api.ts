import type {
  AdminAppSettingRecord,
  AdminAuditLogListResponse,
  AdminJobsResponse,
  AdminOverviewResponse,
  AdminProviderHealthResponse,
  AdminStatsResponse,
  AdminUsersResponse,
  AuthUser,
  ModelConfig
} from '@picup/shared';

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers }
  });

  if (!response.ok) throw new Error(await readErrorMessage(response));
  return response.json() as Promise<T>;
}

async function readErrorMessage(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return `Request failed: ${response.status}`;
  try {
    const payload = JSON.parse(text) as { message?: string | string[]; error?: string };
    if (Array.isArray(payload.message)) return payload.message.join(', ');
    return payload.message || payload.error || text;
  } catch {
    return text;
  }
}

export function getAdminStats() {
  return adminRequest<AdminStatsResponse>('/api/admin/stats');
}

export function getAdminOverview(range = '24h') {
  return adminRequest<AdminOverviewResponse>(`/api/admin/overview?range=${encodeURIComponent(range)}`);
}

export function getAdminProviderHealth() {
  return adminRequest<AdminProviderHealthResponse>('/api/admin/providers/health');
}

export function listAdminUsers(params = new URLSearchParams()) {
  return adminRequest<AdminUsersResponse>(`/api/admin/users?${params.toString()}`);
}

export function updateAdminUserQuota(id: string, quotaUnlimited: boolean) {
  return adminRequest<AuthUser>(`/api/admin/users/${id}/quota`, {
    method: 'PATCH',
    body: JSON.stringify({ quotaUnlimited })
  });
}

export function updateAdminUserStatus(id: string, status: AuthUser['status'], reason: string) {
  return adminRequest<AuthUser>(`/api/admin/users/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason })
  });
}

export function updateAdminUserCredits(id: string, delta: number, reason: string) {
  return adminRequest<AuthUser>(`/api/admin/users/${id}/credits`, {
    method: 'PATCH',
    body: JSON.stringify({ delta, reason })
  });
}

export function deleteAdminUser(id: string) {
  return adminRequest<AuthUser>(`/api/admin/users/${id}`, {
    method: 'DELETE'
  });
}

export function listAdminJobs(params = new URLSearchParams()) {
  return adminRequest<AdminJobsResponse>(`/api/admin/jobs?${params.toString()}`);
}

export function updateAdminModel(id: string, patch: Partial<ModelConfig>) {
  return adminRequest<ModelConfig>(`/api/admin/models/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export function listAdminSettings() {
  return adminRequest<AdminAppSettingRecord[]>('/api/admin/settings');
}

export function upsertAdminSetting(key: string, value: Record<string, unknown>) {
  return adminRequest<AdminAppSettingRecord>(`/api/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value })
  });
}

export function listAdminAuditLogs(params = new URLSearchParams()) {
  return adminRequest<AdminAuditLogListResponse>(`/api/admin/audit-logs?${params.toString()}`);
}
