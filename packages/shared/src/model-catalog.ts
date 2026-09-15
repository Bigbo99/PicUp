import type { ImageProviderName, ModelConfig } from './index';

export interface ModelCatalogEntry extends ModelConfig {
  badgeLabel: string;
  badgeTone: string;
  aliases?: string[];
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    provider: 'grsai',
    model: 'nano-banana-2',
    aliases: ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview'],
    displayName: 'Nano Banana 2',
    description: '快速生成和编辑图片，适合日常改图',
    badgeLabel: 'GrsAI',
    badgeTone: 'bg-blue-50 text-blue-700 border-blue-200',
    enabled: true,
    priority: 10,
    maxInputImages: 6,
    supportedRatios: ['auto', '1:1', '1:8', '1:4', '2:3', '3:2', '3:4', '8:1', '4:1', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'],
    supportedQualities: ['1K', '2K', '4K'],
    costCredits: 1
  },
  {
    provider: 'grsai',
    model: 'nano-banana-pro',
    aliases: ['gemini-3-pro-image', 'gemini-3-pro-image-preview'],
    displayName: 'Nano Banana Pro',
    description: '高质量生成和编辑图片，适合复杂细节',
    badgeLabel: 'GrsAI',
    badgeTone: 'bg-amber-50 text-amber-700 border-amber-200',
    enabled: true,
    priority: 20,
    maxInputImages: 6,
    supportedRatios: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'],
    supportedQualities: ['1K', '2K', '4K'],
    costCredits: 2
  },
  {
    provider: 'gemini-official',
    model: 'gemini-3.1-flash-image',
    aliases: ['gemini-3.1-flash-image-preview'],
    displayName: 'Gemini 3.1 Flash Image',
    description: 'Google Gemini 官方快速图片模型',
    badgeLabel: 'Gemini Official',
    badgeTone: 'bg-amber-50 text-amber-700 border-amber-200',
    enabled: false,
    priority: 30,
    maxInputImages: 6,
    supportedRatios: ['auto', '1:1', '1:8', '1:4', '2:3', '3:2', '3:4', '8:1', '4:1', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'],
    supportedQualities: ['1K', '2K', '4K'],
    costCredits: 1
  },
  {
    provider: 'gemini-official',
    model: 'gemini-3-pro-image',
    aliases: ['gemini-3-pro-image-preview'],
    displayName: 'Gemini 3 Pro Image',
    description: 'Google Gemini 官方专业图片模型',
    badgeLabel: 'Gemini Official',
    badgeTone: 'bg-amber-50 text-amber-700 border-amber-200',
    enabled: false,
    priority: 40,
    maxInputImages: 6,
    supportedRatios: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'],
    supportedQualities: ['1K', '2K', '4K'],
    costCredits: 2
  },
  {
    provider: 'tokenrun',
    model: 'gpt-image-2',
    aliases: ['gpt-image2'],
    displayName: 'GPT Image 2',
    description: '擅长文字生成、指令遵循和精细编辑',
    badgeLabel: 'TokenRun',
    badgeTone: 'bg-rose-50 text-rose-700 border-rose-200',
    enabled: true,
    priority: 30,
    maxInputImages: 4,
    supportedRatios: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
    supportedQualities: ['1K', '2K', '4K'],
    costCredits: 1
  }
];

export const MODEL_CONFIG_DEFAULTS: ModelConfig[] = MODEL_CATALOG.map(({ badgeLabel: _badgeLabel, badgeTone: _badgeTone, aliases: _aliases, ...model }) => model);

export function findModelCatalogEntry(provider: ImageProviderName | string, model: string) {
  const resolvedProvider = provider === 'gemini' ? 'grsai' : provider;
  return MODEL_CATALOG.find((item) =>
    item.provider === resolvedProvider && (item.model === model || item.aliases?.includes(model))
  );
}

export function resolveModelCatalogModel(provider: ImageProviderName | string, model: string) {
  return findModelCatalogEntry(provider, model)?.model ?? model;
}
