export type ImageJobMode = 'generate' | 'edit';
export type ImageProviderName = 'auto' | 'gemini' | 'tokenrun';
export type ImageJobStatus = 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'refunded';
export type ImageQuality = '512' | '1K' | '2K' | '4K';
export type UserRole = 'guest' | 'user' | 'admin';
export type UserStatus = 'pending' | 'active' | 'disabled';
export type ImageTemplate =
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
}

export interface AuthUser {
  id: string;
  email: string | null;
  displayName?: string | null;
  role: UserRole;
  status: UserStatus;
  isGuest: boolean;
  quotaUnlimited: boolean;
  creditBalance: number;
  emailVerifiedAt?: string;
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
  id: 'credits_10_trial' | 'credits_20' | 'credits_45';
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

export const aspectRatioOptions = [
  { label: '跟随原图', value: 'auto' },
  { label: '正方形', value: '1:1' },
  { label: '极窄竖幅', value: '1:8' },
  { label: '长竖幅', value: '1:4' },
  { label: '竖构图', value: '2:3' },
  { label: '横构图', value: '3:2' },
  { label: '商品竖图', value: '3:4' },
  { label: '极宽横幅', value: '8:1' },
  { label: '长横幅', value: '4:1' },
  { label: '横版', value: '4:3' },
  { label: '海报', value: '4:5' },
  { label: '商品横图', value: '5:4' },
  { label: '宽屏横版', value: '16:9' },
  { label: '竖屏', value: '9:16' },
  { label: '超宽横幅', value: '21:9' }
] as const;

export const resolutionOptions: Array<{ label: string; value: ImageQuality; description: string }> = [
  { label: '512', value: '512', description: '快速预览，适合轻量测试' },
  { label: '1K', value: '1K', description: '标准清晰度，适合日常使用' },
  { label: '2K', value: '2K', description: '高清输出，细节更丰富' },
  { label: '4K', value: '4K', description: '最高质量，适合海报和商品图' }
];

export * from './model-catalog';

export const templateOptions: Array<{ label: string; value: ImageTemplate; description: string }> = [
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
