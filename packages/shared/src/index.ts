export type ImageJobMode = 'generate' | 'edit';
// Provider ids are runtime-configured. "auto" remains the only reserved id.
export type ImageProviderName = string;
export type AiProviderType = 'grsai' | 'gemini-official' | 'openai-images';
export type ImageJobStatus = 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'refunded';
export type ImageQuality = '512' | '1K' | '2K' | '4K';
export type UserRole = 'guest' | 'user' | 'admin';
export type UserStatus = 'pending' | 'active' | 'disabled';
export type ImageTemplate =
  | 'auto'
  | 'replace_text'
  | 'remove_object'
  | 'add_object'
  | 'replace_background'
  | 'product'
  | 'style'
  | 'poster_text'
  | 'enhance'
  | 'freeform';

export interface UploadedFileRecord {
  id: string;
  userId?: string;
  hash?: string;
  url: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface OutputImage {
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ImageJobCreateRequest {
  mode: ImageJobMode;
  provider: ImageProviderName;
  model: string;
  template: ImageTemplate;
  prompt: string;
  imageIds: string[];
  aspectRatio: string;
  quality: ImageQuality;
  paymentMode?: 'credits' | 'single' | 'free';
  paymentOrderId?: string | null;
}

export interface ImageJobCreateResponse {
  jobId?: string;
  status?: ImageJobStatus;
  creditsReserved?: number;
  paymentMode?: 'credits' | 'single' | 'free';
  paymentRequired?: boolean;
  paymentOrder?: PaymentOrderResponse;
}

export interface ImageJobRecord extends ImageJobCreateRequest {
  id: string;
  userId?: string;
  status: ImageJobStatus;
  selectedProvider: Exclude<ImageProviderName, 'auto'>;
  selectedModel: string;
  finalPrompt: string;
  inputFiles: UploadedFileRecord[];
  outputImages: OutputImage[];
  textOutputs: string[];
  error: null | {
    code: string;
    message: string;
  };
  creditsReserved: number;
  paymentMode?: 'credits' | 'single' | 'free';
  paymentOrderId?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ModelConfig {
  id?: string;
  provider: Exclude<ImageProviderName, 'auto'>;
  providerDisplayName?: string;
  providerType?: AiProviderType;
  model: string;
  displayName: string;
  description: string;
  enabled: boolean;
  priority?: number;
  maxInputImages: number;
  supportedRatios: string[];
  supportedQualities: ImageQuality[];
  costCredits: number;
}

export interface ModelsResponse {
  models: ModelConfig[];
  defaultProvider: ImageProviderName;
  defaultModel: string;
  source?: 'runtime' | 'fallback';
  routing?: {
    default: AiRoutingTarget;
    professional: AiRoutingTarget;
  };
}

export interface AiRoutingTarget {
  provider: string;
  model: string;
}

export interface AiRequestPaths {
  generate?: string;
  result?: string;
  generations?: string;
  edits?: string;
}

export interface AdminAiModelConfig extends Omit<ModelConfig, 'id' | 'provider' | 'providerDisplayName' | 'providerType'> {
  upstreamModel?: string;
  aliases?: string[];
  qualityModelOverrides?: Partial<Record<ImageQuality, string>>;
  fallbackModels?: string[];
}

export interface AdminAiProviderConfig {
  id: string;
  type: AiProviderType;
  displayName: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  paths: AiRequestPaths;
  defaultModel: string;
  aliases?: string[];
  timeoutMs: number;
  /** Maximum number of generations allowed to run for this provider at once. */
  concurrency?: number;
  /** Maximum number of generation requests started per minute. Zero means unlimited. */
  rpm?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  pollIntervalMs?: number;
  downloadRetryAttempts?: number;
  proxyUrl?: string;
  downloadProxyUrl?: string;
  disableProxy?: boolean;
  models: AdminAiModelConfig[];
}

export interface AdminAiConfigResponse {
  version: number;
  path: string;
  mockEnabled: boolean;
  routing: {
    default: AiRoutingTarget;
    professional: AiRoutingTarget;
  };
  providers: AdminAiProviderConfig[];
}

export interface AdminAiProviderInput {
  id: string;
  type: AiProviderType;
  displayName: string;
  enabled: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl: string;
  paths: AiRequestPaths;
  defaultModel: string;
  aliases?: string[];
  timeoutMs?: number;
  concurrency?: number;
  rpm?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  pollIntervalMs?: number;
  downloadRetryAttempts?: number;
  proxyUrl?: string;
  downloadProxyUrl?: string;
  disableProxy?: boolean;
}

export type AdminAiModelInput = AdminAiModelConfig;

export interface AuthUser {
  id: string;
  email: string | null;
  displayName?: string | null;
  role: UserRole;
  isSuperAdmin?: boolean;
  status: UserStatus;
  isGuest: boolean;
  quotaUnlimited: boolean;
  creditBalance: number;
  emailVerifiedAt?: string;
  lastIp?: string | null;
  lastCountry?: string | null;
  lastRegion?: string | null;
  lastCity?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthMeResponse {
  user: AuthUser;
  quota: {
    dailyTotal: number;
    dailyUsed: number;
    remaining: number;
  };
  credits: {
    balance: number;
    rechargePlans: CreditRechargePlan[];
    singleUsePriceCents: number;
  };
}

export interface AuthCredentials {
  email: string;
  password: string;
  termsAccepted?: boolean;
}

export type EmailAuthMode = 'register' | 'login';

export interface EmailAuthStartRequest {
  email: string;
  password?: string;
  mode: EmailAuthMode;
  termsAccepted?: boolean;
}

export interface EmailAuthStartResponse {
  challengeId: string;
  email: string;
  mode: EmailAuthMode;
  expiresAt: string;
  delivery: 'email' | 'dev';
  devCode?: string;
}

export interface EmailAuthVerifyRequest {
  challengeId: string;
  code: string;
}

export interface WechatAuthStartResponse {
  state: string;
  qrCodeUrl: string;
  expiresAt: string;
}

export interface WechatAuthStatusResponse {
  status: 'pending' | 'confirmed' | 'expired' | 'consumed' | 'failed';
  user?: AuthUser;
  quota?: AuthMeResponse['quota'];
  message?: string;
}

export interface CreditRechargePlan {
  id: 'credits_20' | 'credits_45';
  title: string;
  amountCents: number;
  credits: number;
}

export interface PaymentOrderResponse {
  id: string;
  status: 'pending' | 'paid' | 'failed' | 'closed';
  orderType: 'credit_recharge' | 'single_job';
  amountCents: number;
  credits: number;
  codeUrl?: string;
  createdAt: string;
  paidAt?: string;
}

export interface CreateRechargeOrderRequest {
  planId: CreditRechargePlan['id'];
}

export interface AuthProfileUpdateRequest {
  displayName?: string;
  email?: string;
  password?: string;
}

export interface AdminStatsResponse {
  users: number;
  files: number;
  jobs: number;
  failedJobs: number;
  succeededJobs: number;
  settings: number;
  auditLogs: number;
}

export interface AdminOverviewResponse {
  totals: {
    users: number;
    guests: number;
    registeredUsers: number;
    admins: number;
    activeUsers: number;
    disabledUsers: number;
    pendingUsers: number;
    files: number;
    jobs: number;
    settings: number;
    auditLogs: number;
  };
  guestGeo: Array<{
    country: string;
    region?: string | null;
    city?: string | null;
    guests: number;
    lastSeenAt?: string | null;
  }>;
  jobs: {
    queued: number;
    running: number;
    retrying: number;
    succeeded: number;
    failed: number;
    refunded: number;
    successRate: number;
    rangeCreated: number;
  };
  models: Array<{
    provider: string;
    model: string;
    jobs: number;
    succeeded: number;
    failed: number;
  }>;
  recentFailures: ImageJobRecord[];
}

export interface AdminUserListEnvelope {
  users: AuthUser[];
  nextCursor?: string;
}

export type AdminUsersResponse = AuthUser[] | AdminUserListEnvelope;

export interface AdminUserUpdateRequest {
  displayName?: string | null;
  email?: string | null;
  role?: Extract<UserRole, 'user' | 'admin'>;
  status?: UserStatus;
  quotaUnlimited?: boolean;
  creditBalance?: number;
}

export interface AdminJobListEnvelope {
  jobs: ImageJobRecord[];
  nextCursor?: string;
}

export type AdminJobsResponse = ImageJobRecord[] | AdminJobListEnvelope;

export interface AdminAppSettingRecord {
  key: string;
  value: unknown;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAuditLogRecord {
  id: string;
  actorId: string | null;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  createdAt: string;
}

export interface AdminAuditLogListResponse {
  logs: AdminAuditLogRecord[];
  nextCursor?: string;
}

export interface AdminProviderHealthResponse {
  providers: Array<{
    provider: Exclude<ImageProviderName, 'auto'>;
    configured: boolean;
    enabledModels: number;
    lastCheckedAt: string;
    status: 'healthy' | 'degraded' | 'disabled' | 'unknown';
    message?: string;
  }>;
}

export const aspectRatioOptions = [
  { label: '自动', value: 'auto' },
  { label: '正方形', value: '1:1' },
  { label: '宽屏横版', value: '16:9' },
  { label: '竖屏', value: '9:16' },
  { label: '横版', value: '4:3' },
  { label: '商品竖图', value: '3:4' },
  { label: '横构图', value: '3:2' },
  { label: '竖构图', value: '2:3' },
  { label: '商品横图', value: '5:4' },
  { label: '海报', value: '4:5' },
  { label: '超宽横幅', value: '21:9' },
  { label: '长横幅', value: '4:1' },
  { label: '长竖幅', value: '1:4' },
  { label: '极宽横幅', value: '8:1' },
  { label: '极窄竖幅', value: '1:8' }
] as const;

const TOKENRUN_MIN_PIXELS = 655_360;
const TOKENRUN_MAX_PIXELS = 8_294_400;
const TOKENRUN_MAX_EDGE = 3840;

export function tokenRunSizeFor(aspectRatio: string, quality: ImageQuality) {
  if (aspectRatio === 'auto') return 'auto';

  const [rawWidth, rawHeight] = aspectRatio.split(':').map(Number);
  if (!rawWidth || !rawHeight) throw new Error(`Unsupported GPT Image 2 aspect ratio: ${aspectRatio}`);
  const divisor = greatestCommonDivisor(rawWidth, rawHeight);
  const widthUnits = rawWidth / divisor;
  const heightUnits = rawHeight / divisor;
  const longUnits = Math.max(widthUnits, heightUnits);
  const shortUnits = Math.min(widthUnits, heightUnits);
  const ratio = longUnits / shortUnits;
  if (ratio > 3) throw new Error(`GPT Image 2 aspect ratio exceeds 3:1: ${aspectRatio}`);

  if (rawWidth === rawHeight) {
    const edge = quality === '4K' ? 2880 : quality === '2K' ? 2048 : 1024;
    return `${edge}x${edge}`;
  }

  const targetLongEdge = quality === '4K' ? 3840 : quality === '2K' ? 2048 : 1536;
  let unit = Math.max(16, Math.floor(targetLongEdge / longUnits / 16) * 16);
  let longEdge = longUnits * unit;
  let shortEdge = shortUnits * unit;
  while (longEdge * shortEdge > TOKENRUN_MAX_PIXELS && unit > 16) {
    unit -= 16;
    longEdge = longUnits * unit;
    shortEdge = shortUnits * unit;
  }
  while (
    longEdge * shortEdge < TOKENRUN_MIN_PIXELS
    && longUnits * (unit + 16) <= TOKENRUN_MAX_EDGE
    && longUnits * (unit + 16) * shortUnits * (unit + 16) <= TOKENRUN_MAX_PIXELS
  ) {
    unit += 16;
    longEdge = longUnits * unit;
    shortEdge = shortUnits * unit;
  }

  return rawWidth > rawHeight
    ? `${longEdge}x${shortEdge}`
    : `${shortEdge}x${longEdge}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right);
}

export const resolutionOptions: Array<{ label: string; value: ImageQuality; description: string }> = [
  { label: '512', value: '512', description: '快速预览，适合轻量测试' },
  { label: '1K', value: '1K', description: '标准清晰度，适合日常使用' },
  { label: '2K', value: '2K', description: '高清输出，细节更丰富' },
  { label: '4K', value: '4K', description: '最高质量，适合海报和商品图' }
];

export * from './model-catalog';
export * from './image-intent';

export const templateOptions: Array<{ label: string; value: ImageTemplate; description: string }> = [
  { label: '自动识别', value: 'auto', description: '根据编辑指令自动判断处理方式' },
  { label: '改字', value: 'replace_text', description: '修改图片内文字并保持版式' },
  { label: '去除物体', value: 'remove_object', description: '移除杂物或不需要的元素' },
  { label: '添加元素', value: 'add_object', description: '加入商品、装饰或人物元素' },
  { label: '换背景', value: 'replace_background', description: '替换场景、颜色或环境' },
  { label: '商品图', value: 'product', description: '优化主图、白底图和电商图' },
  { label: '风格化', value: 'style', description: '转换为写实、插画或卡通风格' },
  { label: '海报文字', value: 'poster_text', description: '重排标题、卖点和海报文案' },
  { label: '清晰增强', value: 'enhance', description: '提升画质、细节和质感' },
  { label: '自由编辑', value: 'freeform', description: '按自然语言自由处理' }
];
