import type {
  AdminAiConfigResponse,
  AdminAiModelConfig,
  AdminAiModelInput,
  AdminAiProviderConfig,
  AdminAiProviderInput,
  AdminAppSettingRecord,
  AdminAuditLogListResponse,
  AdminJobsResponse,
  ImageJobRecord,
  AdminOverviewResponse,
  AdminProviderHealthResponse,
  AdminStatsResponse,
  AdminUserUpdateRequest,
  AdminUsersResponse,
  AuthUser
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
  return adminRequest<AdminOverviewResponse>(`/api/admin/overview?range=${encodeURIComponent(range)}`).then(result => ({ ...result, recentFailures: result.recentFailures.map(adminJobMedia) }));
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

export function updateAdminUser(id: string, input: AdminUserUpdateRequest) {
  return adminRequest<AuthUser>(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export function refreshAdminUserIp(id: string) {
  return adminRequest<AuthUser>(`/api/admin/users/${id}/ip-lookup`, {
    method: 'PATCH'
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
  return adminRequest<AdminJobsResponse>(`/api/admin/jobs?${params.toString()}`).then(result => Array.isArray(result) ? result.map(adminJobMedia) : { ...result, jobs: result.jobs.map(adminJobMedia) });
}

function adminJobMedia(job: ImageJobRecord): ImageJobRecord {
  const url = (kind: string, index: number) => `/api/admin/jobs/${encodeURIComponent(job.id)}/media/${kind}/${index}`;
  return { ...job, inputFiles: job.inputFiles.map((file, i) => ({ ...file, url: url('input', i) })), outputImages: job.outputImages.map((image, i) => ({ ...image, url: url('output', i) })), maskFile: job.maskFile ? { ...job.maskFile, url: url('mask', 0) } : undefined };
}

export function getAdminAiConfig() {
  return adminRequest<AdminAiConfigResponse>('/api/admin/ai-config');
}

export function createAdminAiProvider(input: AdminAiProviderInput) {
  return adminRequest<AdminAiProviderConfig>('/api/admin/ai-config/providers', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updateAdminAiProvider(providerId: string, patch: Partial<AdminAiProviderInput>) {
  return adminRequest<AdminAiProviderConfig>(`/api/admin/ai-config/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export function deleteAdminAiProvider(providerId: string) {
  return adminRequest<{ ok: boolean; providerId: string }>(`/api/admin/ai-config/providers/${encodeURIComponent(providerId)}`, {
    method: 'DELETE'
  });
}

export function createAdminAiModel(providerId: string, input: AdminAiModelInput) {
  return adminRequest<AdminAiModelConfig>(`/api/admin/ai-config/providers/${encodeURIComponent(providerId)}/models`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function updateAdminAiModel(providerId: string, modelId: string, patch: Partial<AdminAiModelInput>) {
  return adminRequest<AdminAiModelConfig>(`/api/admin/ai-config/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export function deleteAdminAiModel(providerId: string, modelId: string) {
  return adminRequest<{ ok: boolean; providerId: string; modelId: string }>(`/api/admin/ai-config/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, {
    method: 'DELETE'
  });
}

export function updateAdminAiRouting(routing: AdminAiConfigResponse['routing']) {
  return adminRequest<AdminAiConfigResponse['routing']>('/api/admin/ai-config/routing', {
    method: 'PATCH',
    body: JSON.stringify(routing)
  });
}

export function updateAdminAiMock(mockEnabled: boolean) {
  return adminRequest<{ mockEnabled: boolean }>('/api/admin/ai-config/mock', {
    method: 'PATCH',
    body: JSON.stringify({ mockEnabled })
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
