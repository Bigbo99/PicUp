import type { AiProviderType, AiRequestPaths } from '@picup/shared';

export const providerPresets: Record<AiProviderType, { label: string; baseUrl: string; paths: AiRequestPaths }> = {
  'openai-images': {
    label: 'OpenAI Images 兼容',
    baseUrl: 'https://api.openai.com',
    paths: { generations: '/v1/images/generations', edits: '/v1/images/edits' }
  },
  'openai-compatible': {
    label: 'OpenAI 兼容中转站（Sub2API / New API）',
    baseUrl: 'https://api.example.com',
    paths: { generations: '/v1/images/generations', edits: '/v1/images/edits' }
  },
  'gemini-official': {
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    paths: { generate: '/v1beta/models/{model}:generateContent' }
  },
  grsai: {
    label: 'GrsAI',
    baseUrl: 'https://grsai.dakka.com.cn',
    paths: { generate: '/v1/draw/nano-banana', result: '/v1/draw/result' }
  }
};

export const pathLabels: Record<keyof AiRequestPaths, string> = {
  generate: '生成路径', result: '结果查询路径', generations: '文生图路径', edits: '图片编辑路径'
};
