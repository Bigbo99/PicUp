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
  apiKey: string;
  baseUrl: string;
  paths: AiRequestPaths;
  defaultModel: string;
  timeoutMs: number;
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
