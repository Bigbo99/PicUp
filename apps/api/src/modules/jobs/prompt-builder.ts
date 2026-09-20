import type { ImageTemplate } from '@picup/shared';

const templateInstructions: Record<ImageTemplate, string> = {
  auto: '任务类型：自动识别。根据用户自然语言准确判断并执行图片处理意图。',
  replace_text: '任务类型：改字。保持原图构图、字体风格、光影和背景尽量不变，只修改用户指定文字。',
  remove_object: '任务类型：消除物体。仅消除指定元素，延续原有背景；透明底恢复透明，不透明底自然补全，不改变背景类型，不留下明显痕迹。',
  add_object: '任务类型：添加元素。把新元素自然融入原图，匹配透视、光影和材质。',
  replace_background: '任务类型：换背景。保留主体，替换背景并保持边缘自然。',
  product: '任务类型：商品图优化。突出商品主体，提升电商质感，画面干净专业。',
  style: '任务类型：风格化。保留主体和构图，转换为用户要求的视觉风格。',
  poster_text: '任务类型：海报文字调整。优化文字层级、排版和可读性。',
  enhance: '任务类型：清晰增强。提升细节、清晰度和整体观感，避免过度锐化。',
  freeform: '任务类型：自由编辑。准确执行用户自然语言指令。'
};

export function buildFinalPrompt(template: ImageTemplate, prompt: string) {
  return `${templateInstructions[template]}\n用户需求：${prompt.trim()}\n输出要求：生成可直接下载使用的高质量图片。编辑已有图片时，仅修改用户要求的内容；未要求改变背景时，保留原有透明度，不把透明区域填黑、填白或画成棋盘格，也不将不透明白底误当透明底。`;
}
