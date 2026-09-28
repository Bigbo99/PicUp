import type { ImageJobCreateRequest, ImageTemplate } from '@picup/shared';
import { previewLabels } from './preview-edit';

// Everything sent to image models is assembled here. The same text goes to every
// provider (GPT Image, Nano Banana / Gemini), so keep it plain, directive and
// provider-neutral: short labelled sections, one rule per line, no parameter names.

type Template = Exclude<ImageTemplate, 'auto'>;

const editTemplates: Record<Template, string> = {
  replace_text: '改字：只替换用户指定的文字。新文字沿用原文字的字体、字号、字重、颜色、描边、阴影、透视和对齐方式，逐字准确，不错字、漏字或多字；其他文字和画面保持不变。',
  remove_object: '消除：只移除用户指定的元素，连同它的阴影和倒影。用周围真实背景的纹理、光影和透视自然补全，不留残影、模糊块或重复图案。',
  add_object: '添加元素：按用户描述加入新元素，位置、大小、透视、光照方向、阴影和材质与原画面一致，像原本就在画面中；不遮挡主体的关键部分。',
  replace_background: '换背景：完整保留主体的轮廓、姿态、颜色和细节（发丝、半透明边缘），只替换背景。新背景的透视、光源方向和色调与主体匹配，并补上合理的接触阴影；边缘无白边、光晕或抠图痕迹。',
  product: '商品图优化：商品的外形、颜色、Logo、包装文字和材质保持真实，不改动商品本身；优化布光、背景和构图，画面干净，呈现商业摄影质感。',
  style: '风格化：按用户要求的风格转换，保留原图构图、主体姿态和关键特征，人物保持可辨认；风格统一贯穿整个画面。',
  poster_text: '海报文案：调整标题、卖点等文案的层级、排版和对比度，文字逐字准确、清晰可读，不遮挡主体，版式整洁。',
  enhance: '清晰增强：提升清晰度和细节，修复噪点、模糊和压缩痕迹；不改变内容、构图、色调和人物五官，避免过度锐化、涂抹感和塑料质感皮肤。',
  freeform: ''
};

const generateTemplates: Partial<Record<Template, string>> = {
  product: '商业产品摄影：商品是画面主体，外形和材质真实，布光专业，背景简洁，细节清晰。',
  poster_text: '海报设计：有明确的视觉焦点和文字层级，为文字预留版面，文字清晰可读，版式整洁。',
  style: '风格：严格按用户指定的风格表现，风格统一贯穿整个画面。'
};

const textRule = '画面中需要出现的文字（尤其是引号内的内容）逐字准确呈现，中文字形正确，不出现乱码或无关文字。';
const directRule = '信息不足时按最合理的理解补全细节，直接输出图片，不要反问，也不要只回复文字。';
const transparencyRule = '透明区域是 alpha 通道，不是黑色、白色或棋盘格图案，不要把透明区填成实色；真实的不透明白底仍是白底，不能因为看起来像抠图就变透明。';

export interface PromptContext {
  input: ImageJobCreateRequest;
  /** User text with image references already compiled to "图片 N（名称）". */
  prompt: string;
  subjectNotes?: string[];
}

export function buildFinalPrompt({ input, prompt, subjectNotes = [] }: PromptContext) {
  const sections = input.previewOperation ? previewSections(input)
    : input.mode === 'generate' || !input.imageIds.length ? generateSections(input, prompt)
      : editSections(input, prompt);
  const notes = [...new Set(subjectNotes)];
  if (notes.length) sections.push(section('主体参考', notes));
  return sections.join('\n\n');
}

function section(title: string, lines: string[]) {
  return [`【${title}】`, ...lines.filter(Boolean).map(line => `- ${line}`)].join('\n');
}

function resolved(template: ImageTemplate): Template {
  return template === 'auto' ? 'freeform' : template;
}

function outputSize(input: ImageJobCreateRequest) {
  if (input.width && input.height) return `${input.width}×${input.height} 像素`;
  return input.aspectRatio !== 'auto' ? `${input.aspectRatio} 比例` : '';
}

function generateSections(input: ImageJobCreateRequest, prompt: string) {
  const template = generateTemplates[resolved(input.template)];
  const rules = [
    '完整呈现描述中的主体、数量、动作、场景和风格，不遗漏要素，也不额外添加未要求的主体。',
    textRule,
    '不添加水印、签名、边框或 Logo，除非用户明确要求。',
    // Neither model family can promise real alpha from a text-only request.
    /透明/.test(prompt) ? '用户需要透明背景时，不要画棋盘格，使用干净的纯色背景并保持主体边缘清晰，便于抠图。' : '',
    directRule
  ];
  return [
    section('任务', ['根据用户描述生成一张全新的图片。', template ?? '']),
    section('用户描述', [prompt.trim()]),
    section('要求', rules)
  ];
}

function editSections(input: ImageJobCreateRequest, prompt: string) {
  const count = input.imageIds.length;
  const size = outputSize(input);
  const references = count > 1 ? [
    `共 ${count} 张参考图，按顺序编号为图片 1 到图片 ${count}；描述中的“图片 N（名称）”指对应的参考图。`,
    '用户未指明底图时，以图片 1 作为主画面，其余图片提供主体、元素或风格参考。',
    '引用的人物、商品等主体沿用参考图中的外观特征（面部、发型、服装、颜色、Logo、文字），保持可辨认。'
  ] : ['以图片 1 为唯一的画面基准进行编辑。'];
  const rules = [
    '只修改用户要求的内容；未提及的主体身份、面部、文字、颜色、材质、光影、构图和背景保持不变，不自动美化或添加元素。',
    '用户的明确要求优先于上面的任务默认做法。',
    size ? `输出为 ${size}：通过自然扩展或裁切背景适配，主体完整、不被拉伸变形。` : '保持图片 1 的画幅比例。',
    textRule,
    transparencyRule,
    directRule
  ];
  return [
    section('任务', ['按用户指令编辑参考图片。', editTemplates[resolved(input.template)]]),
    section('参考图', references),
    section('用户指令', [prompt.trim()]),
    section('要求', rules)
  ];
}

function previewSections(input: ImageJobCreateRequest) {
  const operation = input.previewOperation!;
  // preparePreview fills an empty request with the tool label so history has a title;
  // that label is not an instruction from the user.
  const request = input.prompt.trim() === previewLabels[operation] ? '' : input.prompt.trim();
  const task: string[] = [`编辑工具：${previewLabels[operation]}。以图片 1 为唯一的画面基准。`];
  const rules = [
    '只执行本次明确要求的修改；未要求修改的主体身份、文字、颜色、材质、光影和构图保持不变，不自动美化或添加元素。',
    '保持原画布尺寸和画面内容的位置。',
    transparencyRule,
    '除非本次明确要求改变背景，否则保持原背景类型。'
  ];

  if (operation === 'background') {
    task.push('只去除背景，保留完整主体，包括主体内部的白色区域、镂空、毛发和半透明边缘。');
    rules.push('输出背景为真实透明的 PNG，不绘制棋盘格，不添加底色、阴影或描边。');
  }
  if (operation === 'remove') {
    task.push(request ? '在选区内消除用户指定的物体。' : '消除选区内的物体。');
    rules.push(
      '蒙版中透明（alpha=0）的区域是可编辑选区，不透明区域是保护区；选区外完全不变。',
      '被消除物体的后方若是透明背景则恢复透明；若是不透明场景或白底，只延续附近原有背景，不统一填黑、填白，也不虚构新背景。'
    );
  }
  if (operation === 'resize') {
    task.push(`调整为 ${input.aspectRatio} 比例。`);
    rules.splice(1, 1, '保持主体完整，不拉伸主体，必要时自然扩展背景。');
  }
  if (input.background === 'transparent' && operation !== 'background') rules.push('输出 PNG，保留真实透明度和自然边缘。');
  if (input.guideFileId) {
    task.push('图片 2 仅为标记指引：用它定位需要修改的区域，结果中不保留任何标记、编号、圈线或覆盖层。');
  }

  const sections = [section('任务', task)];
  if (request) sections.push(section('用户要求', [request]));
  const comments = (input.editComments ?? []).flatMap((item, index) => item.text.trim()
    ? [`标记 ${index + 1}（横向 ${item.x.toFixed(1)}%，纵向 ${item.y.toFixed(1)}%）：${item.text.trim()}`] : []);
  if (comments.length) {
    sections.push(section('位置批注', [
      '坐标以原图左上角为原点，向右为横向、向下为纵向，按原图宽高的百分比定位；编号只用于对应指令，不要画进结果。',
      ...comments
    ]));
  }
  sections.push(section('要求', [...rules, directRule]));
  return sections;
}
