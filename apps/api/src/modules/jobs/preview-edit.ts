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

// User responses must never contain the provider prompt or internal reference assets.
export function publicJob(job: ImageJobRecord): ImageJobRecord {
  const { maskFile: _mask, maskFileId: _maskId, guideFileId: _guide, systemFileIds: _system, finalPrompt: _final,
    editComments: _comments, quotedSelection: _selection, confirmedCredits: _credits, ...visible } = job;
  const hidden = new Set(job.systemFileIds ?? []);
  const files = job.previewOperation ? [] : job.inputFiles.filter(file => file.purpose !== 'system' && !hidden.has(file.id));
  return { ...visible, finalPrompt: '', inputFiles: files, imageIds: files.map(file => file.id), textOutputs: job.previewOperation ? [] : job.textOutputs,
    error: job.previewOperation && job.error ? { code: job.error.code, message: '图片编辑未能完成，请稍后重试。' } : job.error };
}
