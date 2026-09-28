import type { ImageJobRecord } from '@picup/shared';
import { userModelName } from './user-models';

export function ImageParameters({ job }: { job: ImageJobRecord }) {
  const model = userModelName(job.selectedModel || job.model);
  const ratio = job.aspectRatio === 'auto' ? '自动' : job.aspectRatio;
  const size = job.width && job.height ? `${job.width} × ${job.height} · ${ratio}` : ratio;
  const label = `${model} · ${size} · ${job.quality}`;
  return <div className="canvas-image-meta" title={label} aria-label={`生成参数：${label}`}>
    <span className="image-parameter-model">{model}</span>
    <span className="image-parameter-settings">{size} · {job.quality}</span>
  </div>;
}
