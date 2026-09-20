import { BadRequestException } from '@nestjs/common';
import type { ImageJobCreateRequest, ImageJobRecord } from '@picup/shared';

export const previewLabels: Record<NonNullable<ImageJobCreateRequest['previewOperation']>, string> = {
  describe: '图片编辑', annotate: '标注编辑', comment: '评论编辑', background: '去除背景', remove: '消除物体', resize: '调整比例'
};

export function preparePreview(input: ImageJobCreateRequest): ImageJobCreateRequest {
  if (!input.previewOperation) {
    if (input.guideFileId || input.editComments?.length) throw new BadRequestException('编辑参数缺少操作类型');
    return input;
  }
  if (input.mode !== 'edit' || input.imageIds.length !== 1) throw new BadRequestException('预览编辑需要一张原图');
  if (input.previewOperation === 'remove' && !input.maskFileId) throw new BadRequestException('请先选择要移除的区域');
  return { ...input, provider: 'auto', model: 'auto', template: 'freeform', promptParts: undefined,
    paymentMode: 'credits', prompt: input.prompt.trim() || previewLabels[input.previewOperation],
    background: input.previewOperation === 'background' ? 'transparent' : undefined };
}

export function previewInstructions(input: ImageJobCreateRequest) {
  const parts = [
    `编辑工具：${input.previewOperation ? previewLabels[input.previewOperation] : '图片编辑'}`,
    `用户具体要求：${input.prompt}`,
    '编辑约束：以第一张原图为唯一画面基准，只执行本次明确要求的修改；保留未要求修改的主体身份、文字、颜色、材质、光影和构图，不自动美化或添加元素。',
    '背景约束：透明区域是 alpha 通道，不是黑色、白色或棋盘格图案；不把透明区填成实色。真实不透明的白底仍是白底，不能因看起来像抠图就将其变透明。除非本次明确要求改变背景，否则保持原背景类型。'
  ];
  if (input.previewOperation === 'background') parts.push('去除背景：仅去除背景，保留主体及其内部白色、细孔、毛发和半透明边缘；输出带真实 alpha 通道的 PNG，不绘制棋盘格，不添加底色、阴影或描边。');
  if (input.previewOperation === 'remove') parts.push('消除：蒙版 alpha=0 的区域是可编辑选区，不透明区域是保护区；只消除选区内指定物体。保持原画布尺寸、位置和比例，选区外完全不变。被消除物体后方若是透明背景，恢复透明；若是不透明场景或白底，仅延续附近原有背景，不统一填黑、填白或虚构背景。');
  if (input.background === 'transparent') parts.push('输出参数：background=transparent，输出 PNG，保留真实透明度和自然边缘。');
  if (input.previewOperation === 'resize') parts.push(`调整为 ${input.aspectRatio} 比例，保持主体完整，不拉伸主体，必要时自然扩展背景。`);
  if (input.guideFileId) parts.push('第一张是原图，第二张仅为标记指引。根据指引定位修改区域，输出不保留任何标记、编号、圈线或覆盖层。');
  if (input.editComments?.length) parts.push('坐标以原图左上角为原点，向右为横向、向下为纵向，按原图宽高百分比定位；编号仅用于对应指令，不应绘制到结果。');
  input.editComments?.forEach((item, index) => { if (item.text.trim()) parts.push(`标记 ${index + 1}（横向 ${item.x.toFixed(1)}%，纵向 ${item.y.toFixed(1)}%）：${item.text}`); });
  return parts.join('\n');
}

// User responses must never contain the provider prompt or internal reference assets.
export function publicJob(job: ImageJobRecord): ImageJobRecord {
  const { maskFile: _mask, maskFileId: _maskId, guideFileId: _guide, systemFileIds: _system, finalPrompt: _final,
    editComments: _comments, quotedSelection: _selection, confirmedCredits: _credits, ...visible } = job;
  const hidden = new Set(job.systemFileIds ?? []);
  const files = job.previewOperation ? [] : job.inputFiles.filter(file => file.purpose !== 'system' && !hidden.has(file.id));
  return { ...visible, finalPrompt: '', inputFiles: files, imageIds: files.map(file => file.id), textOutputs: job.previewOperation ? [] : job.textOutputs,
    error: job.previewOperation && job.error ? { code: job.error.code, message: '图片编辑未能完成，请稍后重试。' } : job.error };
}
