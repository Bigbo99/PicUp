import { BadRequestException } from '@nestjs/common';
import { promptPartsText, type ImageJobCreateRequest, type PromptPart } from '@picup/shared';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function compilePromptParts(input: Pick<ImageJobCreateRequest, 'prompt' | 'promptParts' | 'imageIds'>) {
  if (input.promptParts === undefined) return { prompt: input.prompt, imageIds: input.imageIds };
  const parts = input.promptParts;
  if (!Array.isArray(parts) || parts.length > 200) throw new BadRequestException('图片引用格式不正确');
  for (const part of parts) {
    if (!part || typeof part !== 'object') throw new BadRequestException('图片引用格式不正确');
    if (part.type === 'text') {
      if (typeof part.text !== 'string' || part.text.length > 4000 || Object.keys(part).some(key => !['type', 'text'].includes(key))) throw new BadRequestException('文字内容格式不正确');
    } else if (part.type === 'image') {
      if (typeof part.fileId !== 'string' || !uuid.test(part.fileId) || typeof part.label !== 'string' || !part.label.trim() || part.label.length > 120
        || (part.subjectId !== undefined && (typeof part.subjectId !== 'string' || !uuid.test(part.subjectId)))
        || Object.keys(part).some(key => !['type', 'fileId', 'label', 'subjectId'].includes(key))) throw new BadRequestException('图片引用格式不正确');
      if (!input.imageIds.includes(part.fileId)) throw new BadRequestException('引用图片已移除，请重新选择图片');
    } else throw new BadRequestException('不支持的引用类型');
  }
  if (promptPartsText(parts) !== input.prompt || input.prompt.length > 4000) throw new BadRequestException('描述与图片引用不一致，请重新编辑');
  const imageIds = [...new Set([...parts.flatMap(part => part.type === 'image' ? [part.fileId] : []), ...input.imageIds])];
  const prompt = parts.map(part => part.type === 'text' ? part.text : `图片 ${imageIds.indexOf(part.fileId) + 1}（${part.label}）`).join('');
  return { prompt, imageIds };
}

export function subjectReferences(parts?: PromptPart[]) {
  return (parts ?? []).filter((part): part is Extract<PromptPart, { type: 'image' }> => part.type === 'image' && Boolean(part.subjectId));
}
