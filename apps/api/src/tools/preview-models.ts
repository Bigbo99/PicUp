import 'reflect-metadata';
import type { ImageJobCreateRequest } from '@picup/shared';
import { loadEnv } from '../common/env';
import { AiConfigService } from '../common/ai-config/ai-config.service';

loadEnv();

// Lists which configured models can serve each preview-screen action, mirroring the requests
// studio.tsx sends (1K, one original image, plus a guide or mask where the tool uses one).
const operations: Array<{ label: string; input: Partial<ImageJobCreateRequest> }> = [
  { label: '补充描述', input: { previewOperation: 'describe' } },
  { label: '标注', input: { previewOperation: 'annotate', guideFileId: 'guide' } },
  { label: '评论', input: { previewOperation: 'comment', guideFileId: 'guide' } },
  { label: '去除背景', input: { previewOperation: 'background' } },
  { label: '消除', input: { previewOperation: 'remove', maskFileId: 'mask' } },
  { label: '调整尺寸 16:9', input: { previewOperation: 'resize', aspectRatio: '16:9' } }
];

function main() {
  const service = new AiConfigService();
  console.log(`配置文件：${service.path}\n`);
  let blocked = 0;
  for (const { label, input } of operations) {
    const checked = service.previewCandidates({ imageIds: ['original'], aspectRatio: 'auto', quality: '1K', ...input });
    const usable = checked.filter(item => !item.reasons.length);
    if (!usable.length) blocked++;
    console.log(`${usable.length ? '✓' : '✗'} ${label}：${usable.length ? `使用 ${usable[0].provider.id}:${usable[0].model.model}` : '没有可用模型'}`);
    for (const item of checked) {
      console.log(`    ${item.reasons.length ? '-' : '+'} ${item.provider.id}:${item.model.model}${item.reasons.length ? `  ${item.reasons.join('、')}` : ''}`);
    }
  }
  if (blocked) process.exitCode = 1;
}

main();
