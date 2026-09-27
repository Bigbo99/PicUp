import type {
  AdminAiModelConfig,
  AiProviderType,
  AiRequestPaths,
  AiRoutingTarget
} from '@picup/shared';

export interface AiProviderConfig {
  id: string;
  type: AiProviderType;
  displayName: string;
  enabled: boolean;
  aliases?: string[];
  /** Other OpenAI-compatible providers to try when this provider fails. */
  fallbackProviderIds?: string[];
  fallbackOnly?: boolean;
  imageQuality?: 'high';
  imageResponseFormat?: 'url';
  apiKey: string;
  baseUrl: string;
  paths: AiRequestPaths;
  defaultModel: string;
  timeoutMs: number;
  concurrency?: number;
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

export interface AiConfigDocument {
  version: number;
  mockEnabled: boolean;
  routing: {
    default: AiRoutingTarget;
    professional: AiRoutingTarget;
  };
  providers: AiProviderConfig[];
}
