import type { ImageTemplate } from './index';

export interface ImageIntentResult {
  template: Exclude<ImageTemplate, 'auto'>;
  confidence: 'high' | 'medium' | 'low';
}

const intentRules: Array<{
  template: Exclude<ImageTemplate, 'auto'>;
  pattern: RegExp;
}> = [
  {
    template: 'replace_background',
    pattern: /(换|替换|更换|修改|改成|变成|去掉|移除).{0,8}背景|背景.{0,8}(换|替换|更换|修改|改成|变成)|去背|抠图|透明背景/i
  },
  {
    template: 'remove_object',
    pattern: /(删除|去掉|去除|移除|消除|擦除|抹掉|不要).{0,12}(物体|人物|人|文字|水印|杂物|元素|东西|logo|标志|图案)?/i
  },
  {
    template: 'add_object',
    pattern: /(添加|加入|增加|加上|放入|放上|补上|新增).{0,16}(物体|人物|人|文字|元素|商品|装饰|logo|标志|图案)?/i
  },
  {
    template: 'poster_text',
    pattern: /(海报|封面|宣传图|主视觉).{0,12}(文字|标题|文案|排版|卖点)|排版.{0,8}(海报|标题|文案)/i
  },
  {
    template: 'replace_text',
    pattern: /(改|修改|替换|更换|换).{0,8}(字|文字|标题|文案|内容)|把.{0,12}(字|文字|标题|文案).{0,8}(改|换|替换)|换字/i
  },
  {
    template: 'product',
    pattern: /(商品图|产品图|电商|主图|详情页|白底图|商品质感|产品质感|商业摄影)/i
  },
  {
    template: 'enhance',
    pattern: /(清晰|高清|超清|增强|修复|放大|降噪|锐化|提升画质|改善画质|老照片)/i
  },
  {
    template: 'style',
    pattern: /(风格|卡通|动漫|插画|油画|水彩|素描|赛博朋克|像素|写实|国风|二次元)/i
  }
];

export function detectImageIntent(prompt: string, hasReferenceImages: boolean): ImageIntentResult {
  const normalized = prompt.trim();
  if (!normalized) return { template: 'freeform', confidence: 'low' };

  for (const rule of intentRules) {
    if (rule.pattern.test(normalized)) return { template: rule.template, confidence: 'high' };
  }

  return {
    template: hasReferenceImages ? 'freeform' : 'freeform',
    confidence: hasReferenceImages ? 'medium' : 'low'
  };
}
