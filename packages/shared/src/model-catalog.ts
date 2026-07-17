import type { ImageProviderName, ModelConfig } from './index';

export interface ModelCatalogEntry extends ModelConfig {
  badgeLabel: string;
  badgeTone: string;
  aliases?: string[];
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    provider: 'gemini',
    model: 'gemini-3.1-flash-image',
    aliases: ['gemini-3.1-flash-image-preview'],
    displayName: 'Nano Banana 2',
    description: 'Gemini 3.1 Flash Image',
    badgeLabel: 'Gemini',
    badgeTone: 'bg-blue-50 text-blue-700 border-blue-200',
    enabled: true,
    priority: 10,
    maxInputImages: 6,
    supportedRatios: ['auto', '1:1', '1:8', '1:4', '2:3', '3:2', '3:4', '8:1', '4:1', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'],
    supportedQualities: ['1K', '2K', '4K'],
    costCredits: 1
  },
  {
    provider: 'gemini',
    model: 'gemini-3-pro-image',
    aliases: ['gemini-3-pro-image-preview'],
    displayName: 'Nano Banana Pro',
    description: 'Gemini 3 Pro Image',
    badgeLabel: 'Gemini',
    badgeTone: 'bg-amber-50 text-amber-700 border-amber-200',
    enabled: true,
    priority: 20,
    maxInputImages: 6,
    supportedRatios: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'],
    supportedQualities: ['1K', '2K', '4K'],
    costCredits: 2
  },
  {
    provider: 'tokenrun',
    model: 'gpt-image-2',
    aliases: ['gpt-image2'],
    displayName: 'TokenRun',
    description: 'GPT Image 2',
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

export const MODEL_CONFIG_DEFAULTS: ModelConfig[] = MODEL_CATALOG.map(({ badgeLabel, badgeTone, aliases, ...model }) => model);

export function findModelCatalogEntry(provider: ImageProviderName | string, model: string) {
  return MODEL_CATALOG.find((item) =>
    item.provider === provider && (item.model === model || item.aliases?.includes(model))
  );
}

export function resolveModelCatalogModel(provider: ImageProviderName | string, model: string) {
  return findModelCatalogEntry(provider, model)?.model ?? model;
}
