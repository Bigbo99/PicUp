import type { ImageTemplate } from './index';

type ResolvedTemplate = Exclude<ImageTemplate, 'auto'>;

// Order matters: the first match wins, so narrower intents come before broader ones
// (e.g. "去掉背景" is a background task, not object removal).
const editRules: Array<{ template: ResolvedTemplate; pattern: RegExp }> = [
  {
    template: 'replace_background',
    pattern: /(换|替换|更换|修改|改成|变成|去掉|去除|移除|删除).{0,8}背景|背景.{0,8}(换|替换|更换|改成|变成)|去背|抠图|抠出|透明背景|透明底/i
  },
  {
    template: 'replace_text',
    pattern: /(改|修改|替换|更换|换)(成|为)?.{0,6}(字|文字|标题|文案|标语|价格|日期)|把.{0,12}(字|文字|标题|文案|标语|价格|日期).{0,8}(改|换|替换)|换字|改字|错别字/i
  },
  {
    template: 'remove_object',
    pattern: /(删除|删掉|去掉|去除|移除|消除|擦除|擦掉|抹掉|P掉)|去水印/i
  },
  {
    template: 'add_object',
    pattern: /(添加|加入|加上|放入|放上|补上|新增)|加(个|一个|一只|一些|一朵|一行|一句)/i
  },
  { template: 'poster_text', pattern: /(海报|封面|宣传图|主视觉|banner).{0,12}(文字|标题|文案|排版|卖点)|排版/i },
  { template: 'product', pattern: /商品图|产品图|电商|主图|详情页|白底图|商品质感|产品质感|商业摄影/i },
  { template: 'enhance', pattern: /高清|超清|清晰度|变清晰|修复|放大|降噪|去噪|锐化|画质|老照片/i },
  { template: 'style', pattern: /风格|卡通|动漫|插画|油画|水彩|素描|赛博朋克|像素风|国风|二次元|手绘/i }
];

// Without a source image only creative intents apply; edit intents fall back to freeform.
const generateRules: Array<{ template: ResolvedTemplate; pattern: RegExp }> = [
  { template: 'poster_text', pattern: /海报|封面|宣传图|主视觉|banner|传单|邀请函|招贴/i },
  { template: 'product', pattern: /商品图|产品图|电商|主图|详情页|白底图|产品摄影|商业摄影/i },
  { template: 'style', pattern: /风格|卡通|动漫|插画|油画|水彩|素描|赛博朋克|像素风|国风|二次元|手绘/i }
];

export function detectImageIntent(prompt: string, hasReferenceImages: boolean): ResolvedTemplate {
  const normalized = prompt.trim();
  const rules = hasReferenceImages ? editRules : generateRules;
  return rules.find(rule => rule.pattern.test(normalized))?.template ?? 'freeform';
}
