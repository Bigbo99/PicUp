import type { AiRoutingTarget, ModelConfig, ModelsResponse } from '@picup/shared';

const modelNames: Record<string, string> = {
  'nano-banana-2': 'Nano Banana 2',
  'nano-banana-pro': 'Nano Banana Pro',
  'gemini-3.1-flash-image': 'Gemini 3.1 Flash Image',
  'gemini-3-pro-image': 'Gemini 3 Pro Image',
  'gpt-image-2': 'GPT Image 2',
  'gpt-image-2.5-flare': 'GPT Image 2.5 Flare',
  'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst'
};

const modelGuidance: Record<string, string> = {
  auto: '根据所选清晰度推荐模型，适合不确定如何选择时使用。',
  'nano-banana-2': '快速生成和编辑图片，适合日常改图与尝试创意。',
  'nano-banana-pro': '注重画面质量和复杂细节，适合商品图与精修。',
  'gemini-3.1-flash-image': '快速生成和修改画面，适合反复尝试不同方案。',
  'gemini-3-pro-image': '注重画面细节，适合复杂场景与高质量图片创作。',
  'gpt-image-2': '擅长文字生成和精细编辑，适合海报、改字与局部修改。',
  'gpt-image-2.5-flare': '适合按文字要求创作画面，调整构图与视觉风格。',
  'gpt-image-2.5-sunburst': '适合人物、商品等画面创作，以及细节修改。'
};

function modelKey(model: string) {
  const key = model.toLowerCase();
  return key === 'sunburst' || key === 'flare' ? `gpt-image-2.5-${key}` : key;
}

export function userModelName(model: string, displayName?: string) {
  return modelNames[modelKey(model)] ?? (displayName?.trim() || model.replace(/[-_]/g, ' '));
}

export function userModelGuidance(model: string) {
  return modelGuidance[modelKey(model).replace(/-preview$/, '')] ?? '适合图片生成与编辑，可按需要尝试不同画面效果。';
}

export function userModels(response?: ModelsResponse): ModelConfig[] {
  const options = new Map<string, ModelConfig>();
  const route = response?.routing?.default;
  for (const model of response?.models ?? []) {
    const key = modelKey(model.model);
    if (!model.enabled || (/^gpt(?:-|$)/.test(key) && !modelNames[key])) continue;
    if (!options.has(key) || (model.provider === route?.provider && model.model === route.model)) {
      options.set(key, { ...model, displayName: userModelName(model.model, model.displayName) });
    }
  }
  return [...options.values()];
}

export function selectedUserModel(models: ModelConfig[], provider: string, model: string, defaultTarget?: AiRoutingTarget) {
  const automatic = provider === 'auto' ? models.find(item => item.provider === defaultTarget?.provider && item.model === defaultTarget.model) : undefined;
  return automatic ?? models.find(item => item.provider === provider && item.model === model)
    ?? models.find(item => modelKey(item.model) === modelKey(model))
    ?? models.find(item => item.provider === defaultTarget?.provider && item.model === defaultTarget.model)
    ?? models[0];
}
