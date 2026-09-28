import type { AdminAiModelConfig, AiProviderType, ImageQuality } from './index';

export interface ImageModelPreset {
  model: string;
  displayName: string;
  protocols: AiProviderType[];
  aliases: string[];
  ratios: string[];
  resolutions: ImageQuality[];
  referenceLimit: number;
  sourceUrl: string;
  sourceLabel: string;
  sizeDescription: string;
  renderQualities?: string[];
}

const openaiSource = 'https://developers.openai.com/api/docs/guides/image-generation';
const googleSource = 'https://ai.google.dev/gemini-api/docs/image-generation';
const standardRatios = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'];
const wideRatios = [...standardRatios, '1:4', '4:1', '1:8', '8:1'];

// Reviewed 2026-09-28. These are model capabilities, not proof of relay support.
export const IMAGE_MODEL_PRESETS: ImageModelPreset[] = [
  ...['nano-banana-2', 'nano-banana-pro'].map(model => ({
    model, displayName: model === 'nano-banana-2' ? 'Nano Banana 2' : 'Nano Banana Pro',
    protocols: ['grsai'] as AiProviderType[], aliases: [],
    ratios: model === 'nano-banana-2' ? wideRatios : standardRatios,
    resolutions: ['1K', '2K', '4K'] as ImageQuality[], referenceLimit: 6,
    sourceUrl: 'https://grsai.ai/dashboard/documents/nano-banana', sourceLabel: 'GrsAI 接口文档',
    sizeDescription: '渠道文档支持 1K / 2K / 4K；PicUp 最多接收 6 张参考图。'
  })),
  ...['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].map(model => ({
    model, displayName: model === 'gpt-image-2' ? 'GPT Image 2' : `GPT Image 2.5 ${model.endsWith('flare') ? 'Flare' : 'Sunburst'}`,
    protocols: ['openai-images', 'openai-compatible'] as AiProviderType[], aliases: [],
    ratios: standardRatios, resolutions: ['1K', '2K', '4K'] as ImageQuality[], referenceLimit: 6,
    sourceUrl: openaiSource, sourceLabel: 'OpenAI 官方文档',
    sizeDescription: '宽高为 16 的倍数，最长边 3840px，比例不超过 3:1；655,360–8,294,400 像素。超过 2560×1440 的输出为实验能力。',
    renderQualities: model === 'gpt-image-2' ? ['auto', 'low', 'medium', 'high'] : ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
  })),
  ...['gemini-3.1-flash-image', 'gemini-3-pro-image'].map(model => ({
    model, displayName: model.includes('flash') ? 'Gemini 3.1 Flash Image' : 'Gemini 3 Pro Image',
    protocols: ['gemini-official'] as AiProviderType[], aliases: [`${model}-preview`],
    ratios: model.includes('flash') ? wideRatios : standardRatios,
    resolutions: (model.includes('flash') ? ['512', '1K', '2K', '4K'] : ['1K', '2K', '4K']) as ImageQuality[],
    referenceLimit: 6, sourceUrl: googleSource, sourceLabel: 'Google 官方文档',
    sizeDescription: '按宽高比和分辨率档位输出；官方最多 14 张参考图，PicUp 当前最多接收 6 张。'
  }))
];

export function imageModelPreset(type: AiProviderType, model: string) {
  return IMAGE_MODEL_PRESETS.find(item => item.protocols.includes(type)
    && (item.model === model || item.aliases.includes(model)));
}

export function imageModelDefaults(preset: ImageModelPreset, model = preset.model): AdminAiModelConfig {
  return {
    model, upstreamModel: model, displayName: preset.displayName, description: '', enabled: true,
    priority: 100, maxInputImages: preset.referenceLimit, supportedRatios: [...preset.ratios],
    supportedQualities: [...preset.resolutions], costCredits: 1
  };
}

export interface AvailableImageModel {
  model: string;
  installed: boolean;
  preset?: ImageModelPreset;
  defaults?: AdminAiModelConfig;
  listed: boolean;
}

export interface AvailableImageModels {
  providerId: string;
  checkedAt: string;
  source: 'remote' | 'configured';
  models: AvailableImageModel[];
  omitted: number;
  message: string;
}
