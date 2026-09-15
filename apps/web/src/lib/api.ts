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

export type StudioPreferences = { theme: 'system' | 'light' | 'dark'; quality: '1K' | '2K' | '4K'; aspectRatio: string; provider: string; model: string };
export const displayFile = (file: UploadedFileRecord): UploadedFileRecord => ({ ...file, url: `/api/files/${encodeURIComponent(file.id)}/content` });
const displayJob = (job: ImageJobRecord): ImageJobRecord => ({ ...job, inputFiles: job.inputFiles.map(displayFile), outputImages: job.outputImages.map((image, index) => ({ ...image, url: `/api/image/jobs/${encodeURIComponent(job.id)}/preview/${index}` })) });
export type StudioAsset = { key: string; fileId: string | null; jobId: string | null; subjectId?: string; index: number; url: string; title: string; kind: string; createdAt: string };
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
  return { ...result, items: result.items.map(asset => ({ ...asset, url: asset.fileId ? `/api/files/${encodeURIComponent(asset.fileId)}/content` : `/api/image/jobs/${encodeURIComponent(asset.jobId!)}/preview/${asset.index}` })) };
};
export const listStudioConversations = (q: string, offset: number, archived = false) => request<{ items: StudioConversation[]; next: number | null }>(`/api/studio/conversations?${new URLSearchParams({ q, offset: String(offset), archived: String(archived) })}`);
export const updateStudioConversation = (rootJobId: string, action: 'archive' | 'restore') => request<{ ok: boolean; rootJobId: string; archived: boolean }>(`/api/studio/conversations/${encodeURIComponent(rootJobId)}`, { method: 'PATCH', body: JSON.stringify({ action }) });
export const deleteStudioConversation = (rootJobId: string) => request<{ ok: boolean; rootJobId: string }>(`/api/studio/conversations/${encodeURIComponent(rootJobId)}`, { method: 'DELETE' });
export const updateStudioAsset = (key: string, data: { title?: string; hidden?: boolean }) => request(`/api/studio/assets/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(data) });

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers }
  }).catch(error => { throw new Error(userMessage(error)); });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json().catch(() => { throw new Error('服务返回异常，请稍后重试。'); }) as Promise<T>;
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

export async function uploadImage(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<UploadedFileRecord>('/api/files', {
    method: 'POST',
    body: form
  }).then(displayFile);
}

export async function createImageJob(input: ImageJobCreateRequest) {
  return request<ImageJobCreateResponse>('/api/image/jobs', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getImageJob(id: string) {
  return request<ImageJobRecord>(`/api/image/jobs/${id}`).then(displayJob);
}

export async function listImageJobs(options: { cursor?: string; q?: string; status?: string } = {}) {
  const params = new URLSearchParams({ limit: '20' });
  for (const [key, value] of Object.entries(options)) if (value) params.set(key, value);
  return request<ImageJobRecord[]>(`/api/image/jobs?${params}`).then(jobs => jobs.map(displayJob));
}

export function quoteImageJob(input: ImageJobCreateRequest) {
  return request<JobQuote>('/api/image/jobs/quote', { method: 'POST', body: JSON.stringify(input) });
}

export function referenceJobOutput(id: string, index: number) {
  return request<UploadedFileRecord>(`/api/image/jobs/${id}/reference/${index}`, { method: 'POST' }).then(displayFile);
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
