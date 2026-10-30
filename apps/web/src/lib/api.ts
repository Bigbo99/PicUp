import { MODEL_CONFIG_DEFAULTS } from '@picup/shared';
import { userMessage } from './user-message';
import type {
  AiProviderType,
  ImageJobCreateRequest,
  ImageJobCreateResponse,
  ImageJobRecord,
  JobQuote,
  ModelsResponse,
  UploadedFileRecord,
  StudioSubject,
  AuthCredentials,
  AuthProfileUpdateRequest,
  AuthMeResponse,
  CreateRechargeOrderRequest,
  EmailAuthStartRequest,
  EmailAuthStartResponse,
  EmailAuthVerifyRequest,
  PaymentOrderResponse,
  WechatAuthStartResponse,
  WechatAuthStatusResponse
} from '@picup/shared';

const fallbackProviderMeta: Record<string, { displayName: string; type: AiProviderType }> = {
  grsai: { displayName: 'GrsAI', type: 'grsai' },
  'gemini-official': { displayName: 'Gemini Official', type: 'gemini-official' },
  tokenrun: { displayName: 'TokenRun', type: 'openai-images' }
};

const FALLBACK_MODELS_RESPONSE: ModelsResponse = {
  models: MODEL_CONFIG_DEFAULTS.map((model) => ({
    ...model,
    id: `${model.provider}:${model.model}`,
    providerDisplayName: fallbackProviderMeta[model.provider]?.displayName ?? model.provider,
    providerType: fallbackProviderMeta[model.provider]?.type
  })),
  defaultProvider: 'auto',
  defaultModel: 'nano-banana-2',
  source: 'fallback',
  routing: {
    default: { provider: 'grsai', model: 'nano-banana-2' },
    professional: { provider: 'grsai', model: 'nano-banana-pro' }
  }
};

/** Always use relative paths; Next.js rewrites or Nginx forwards requests to the API service. */
const API_BASE_URL = '';

export const authorizeWechatProfile = () => request<{ authorization_url: string; authorization_id: string; expires_at: string }>('/api/auth/wechat/profile/authorize', { method: 'POST' });
export const syncWechatProfile = () => request<{ status: string }>('/api/auth/wechat/profile/sync', { method: 'POST' });

export type StudioPreferences = { theme: 'system' | 'light' | 'dark'; quality: '1K' | '2K' | '4K'; aspectRatio: string; provider: string; model: string };
export const displayFile = (file: UploadedFileRecord): UploadedFileRecord => { const url = `/api/files/${encodeURIComponent(file.id)}/content`; return { ...file, url, thumbnailUrl: `${url}?variant=thumbnail` }; };
const displayJob = (job: ImageJobRecord): ImageJobRecord => ({ ...job, inputFiles: job.inputFiles.map(displayFile), outputImages: job.outputImages.map((image, index) => { const url = `/api/image/jobs/${encodeURIComponent(job.id)}/preview/${index}`; return { ...image, url, thumbnailUrl: `${url}?variant=thumbnail` }; }) });
export type StudioAsset = { key: string; fileId: string | null; jobId: string | null; subjectId?: string; index: number; url: string; thumbnailUrl?: string; title: string; kind: string; createdAt: string };
export const listStudioSubjects = async (q = '', offset = 0) => {
  const result = await request<{ items: StudioSubject[]; next: number | null }>(`/api/studio/subjects?${new URLSearchParams({ q, offset: String(offset) })}`);
  return { ...result, items: result.items.map(subject => ({ ...subject, file: displayFile(subject.file) })) };
};
export const createStudioSubject = async (input: { name: string; description: string; fileId: string }) => {
  const subject = await request<StudioSubject>('/api/studio/subjects', { method: 'POST', body: JSON.stringify(input) });
  return { ...subject, file: displayFile(subject.file) };
};
export type StudioConversation = { id: string; title: string; jobId: string; count: number; status: string; updatedAt: string; archived?: boolean };
export const getStudioPreferences = () => request<Partial<StudioPreferences>>('/api/studio/preferences');
export const saveStudioPreferences = (input: Partial<StudioPreferences>) => request<Partial<StudioPreferences>>('/api/studio/preferences', { method: 'PATCH', body: JSON.stringify(input) });
export const listStudioAssets = async (q: string, kind: string, offset: number) => {
  const result = await request<{ items: StudioAsset[]; next: number | null }>(`/api/studio/assets?${new URLSearchParams({ q, kind, offset: String(offset) })}`);
  return { ...result, items: result.items.map(asset => { const url = asset.fileId ? `/api/files/${encodeURIComponent(asset.fileId)}/content` : `/api/image/jobs/${encodeURIComponent(asset.jobId!)}/preview/${asset.index}`; return { ...asset, url, thumbnailUrl: `${url}?variant=thumbnail` }; }) };
};
export const listStudioConversations = (q: string, offset: number, archived = false) => request<{ items: StudioConversation[]; next: number | null }>(`/api/studio/conversations?${new URLSearchParams({ q, offset: String(offset), archived: String(archived) })}`);
export const updateStudioConversation = (rootJobId: string, action: 'archive' | 'restore') => request<{ ok: boolean; rootJobId: string; archived: boolean }>(`/api/studio/conversations/${encodeURIComponent(rootJobId)}`, { method: 'PATCH', body: JSON.stringify({ action }) });
export const deleteStudioConversation = (rootJobId: string) => request<{ ok: boolean; rootJobId: string }>(`/api/studio/conversations/${encodeURIComponent(rootJobId)}`, { method: 'DELETE' });
export const updateStudioAsset = (key: string, data: { title?: string; hidden?: boolean }) => request(`/api/studio/assets/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(data) });

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal: controller?.signal ?? init?.signal,
    credentials: 'include',
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers }
  }).catch(error => { throw new Error(userMessage(error)); });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return await response.json().catch(error => { throw new Error('服务返回异常，请稍后重试。', { cause: error }); }) as T;
  } catch (error) {
    if (controller?.signal.aborted) throw new Error('请求超时，请检查网络后重试；已提交的任务可在历史记录查看。', { cause: error });
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}

async function readErrorMessage(response: Response) {
  const fallback = userMessage('', response.status);
  const text = await response.text().catch(() => '');
  if (!text) return fallback;

  try {
    const payload = JSON.parse(text) as { message?: string | string[]; error?: string };
    if (Array.isArray(payload.message)) return [...new Set(payload.message.map(message => userMessage(message, response.status)))].join(' ');
    return userMessage(payload.message || payload.error || '', response.status);
  } catch {
    return userMessage('', response.status);
  }
}

export const uploadImage = (file: File) => uploadFile(file, 'user');
export const uploadSystemImage = (file: File) => uploadFile(file, 'system');

async function uploadFile(file: File, purpose: 'user' | 'system') {
  const form = new FormData();
  form.append('file', file);
  return request<UploadedFileRecord>(`/api/files?purpose=${purpose}`, {
    method: 'POST',
    body: form
  }, 60_000).then(displayFile);
}

export async function createImageJob(input: ImageJobCreateRequest) {
  return request<ImageJobCreateResponse>('/api/image/jobs', {
    method: 'POST',
    body: JSON.stringify(input)
  }, 60_000);
}

export async function getImageJob(id: string) {
  return request<ImageJobRecord>(`/api/image/jobs/${id}`, undefined, 30_000).then(displayJob);
}

export function getOutputHashes(id: string, signal?: AbortSignal) {
  return request<string[]>(`/api/image/jobs/${encodeURIComponent(id)}/output-hashes`, { signal });
}

export async function listImageJobs(options: { cursor?: string; q?: string; status?: string } = {}) {
  const params = new URLSearchParams({ limit: '20' });
  for (const [key, value] of Object.entries(options)) if (value) params.set(key, value);
  return request<ImageJobRecord[]>(`/api/image/jobs?${params}`).then(jobs => jobs.map(displayJob));
}

export function quoteImageJob(input: ImageJobCreateRequest) {
  return request<JobQuote>('/api/image/jobs/quote', { method: 'POST', body: JSON.stringify(input) }, 30_000);
}

export function referenceJobOutput(id: string, index: number) {
  return request<UploadedFileRecord>(`/api/image/jobs/${id}/reference/${index}`, { method: 'POST' }, 60_000).then(displayFile);
}

export function getAccountActivity() {
  return request<{ entries: Array<{ key: string; kind: string; delta: number; createdAt: string }>; orders: PaymentOrderResponse[] }>('/api/payments/activity');
}

export async function deleteImageJob(id: string) {
  return request<{ ok: boolean; jobId: string }>(`/api/image/jobs/${id}`, {
    method: 'DELETE'
  });
}

export async function getModels() {
  try {
    return await request<ModelsResponse>('/api/models');
  } catch (error) {
    console.warn('[models] runtime model API unavailable, using fallback catalog', error);
    return FALLBACK_MODELS_RESPONSE;
  }
}

export async function getMe() {
  return request<AuthMeResponse>('/api/auth/me');
}

export async function login(input: AuthCredentials) {
  return request<AuthMeResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function register(input: AuthCredentials) {
  return request<AuthMeResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function startEmailAuth(input: EmailAuthStartRequest) {
  return request<EmailAuthStartResponse>('/api/auth/email/start', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function verifyEmailAuth(input: EmailAuthVerifyRequest) {
  return request<AuthMeResponse>('/api/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function startWechatAuth() {
  return request<WechatAuthStartResponse>('/api/auth/wechat/start', {
    method: 'POST'
  });
}

export async function getWechatAuthStatus(state: string) {
  return request<WechatAuthStatusResponse>(`/api/auth/wechat/status?state=${encodeURIComponent(state)}`);
}

export async function logout() {
  return request<{ ok: boolean }>('/api/auth/logout', {
    method: 'POST'
  });
}

export const startProfileEmailChange = (email: string) => request<{ challengeId: string; email: string; devCode?: string }>(
  '/api/auth/profile/email/start', { method: 'POST', body: JSON.stringify({ email }) }
);

export async function updateProfile(input: AuthProfileUpdateRequest) {
  return request<AuthMeResponse>('/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function getPaymentPlans() {
  return request<Pick<AuthMeResponse['credits'], 'rechargePlans'>>('/api/payments/plans');
}

export async function createRechargeOrder(input: CreateRechargeOrderRequest) {
  return request<PaymentOrderResponse>('/api/payments/recharge', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getPaymentOrder(id: string) {
  return request<PaymentOrderResponse>(`/api/payments/orders/${id}`);
}
