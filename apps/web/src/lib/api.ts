import type {
  ImageJobCreateRequest,
  ImageJobCreateResponse,
  ImageJobRecord,
  ModelsResponse,
  UploadedFileRecord,
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

/** Always use relative paths; Next.js rewrites or Nginx forwards requests to the API service. */
const API_BASE_URL = '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body instanceof FormData
      ? init.headers
      : { 'Content-Type': 'application/json', ...init?.headers }
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json() as Promise<T>;
}

async function readErrorMessage(response: Response) {
  const fallback = `请求失败：${response.status}`;
  const text = await response.text().catch(() => '');
  if (!text) return fallback;

  try {
    const payload = JSON.parse(text) as { message?: string | string[]; error?: string };
    if (Array.isArray(payload.message)) return payload.message.join('；');
    return payload.message || payload.error || text;
  } catch {
    return text;
  }
}

export async function uploadImage(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<UploadedFileRecord>('/api/files', {
    method: 'POST',
    body: form
  });
}

export async function createImageJob(input: ImageJobCreateRequest) {
  return request<ImageJobCreateResponse>('/api/image/jobs', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getImageJob(id: string) {
  return request<ImageJobRecord>(`/api/image/jobs/${id}`);
}

export async function listImageJobs() {
  return request<ImageJobRecord[]>('/api/image/jobs?limit=20');
}

export async function deleteImageJob(id: string) {
  return request<{ ok: boolean; jobId: string }>(`/api/image/jobs/${id}`, {
    method: 'DELETE'
  });
}

export async function getModels() {
  return request<ModelsResponse>('/api/models');
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
