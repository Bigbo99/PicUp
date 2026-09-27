import type { ImageJobRecord } from '@picup/shared';

export function ImageParameters({ job }: { job: ImageJobRecord }) {
  const model = job.selectedModel || job.model;
  const ratio = job.aspectRatio === 'auto' ? '自动' : job.aspectRatio;
  const label = `${model} · ${ratio} · ${job.quality}`;
  return <div className="canvas-image-meta" title={label} aria-label={`生成参数：${label}`}>
    <span className="image-parameter-model">{model}</span>
    <span className="image-parameter-settings">{ratio} · {job.quality}</span>
  </div>;
}
