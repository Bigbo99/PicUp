import type { StudioAsset } from '@/lib/api';

export async function downloadAssets(assets: StudioAsset[]) {
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  // Bound memory use on phones and fetch sequentially to avoid large parallel buffers.
  for (const [index, asset] of assets.entries()) {
    const url = asset.jobId ? `/api/image/jobs/${encodeURIComponent(asset.jobId)}/download/${asset.index}` : asset.url;
    const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`第 ${index + 1} 张图片下载失败，请重试。`);
    const blob = await response.blob();
    const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[blob.type];
    if (!extension) throw new Error(`第 ${index + 1} 张图片格式异常，请重试。`);
    totalBytes += blob.size;
    if (totalBytes > 100 * 1024 * 1024) throw new Error('所选图片超过 100MB，请分批下载。');
    // eslint-disable-next-line no-control-regex -- Archive filenames must remove control characters.
    const name = asset.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.[^.]+$/, '').trim().slice(0, 80) || 'image';
    files[`${String(index + 1).padStart(3, '0')}-${name}.${extension}`] = new Uint8Array(await blob.arrayBuffer());
  }
  const zipped = zipSync(files, { level: 0 });
  const url = URL.createObjectURL(new Blob([new Uint8Array(zipped)], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `PicUp-${new Date().toISOString().slice(0, 10)}-${assets.length}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
