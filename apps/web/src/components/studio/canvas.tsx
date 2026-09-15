'use client';

import { useEffect, useState } from 'react';
import { Download, ImagePlus, Loader2, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ImageJobRecord, UploadedFileRecord } from '@picup/shared';
import type { PreviewImage } from './image-lightbox';
import { userMessage } from '@/lib/user-message';

export const isWorking = (status?: string) => ['queued', 'running', 'retrying'].includes(status ?? '');
export const statusLabels: Record<string, string> = {
  queued: '排队中', running: '生成中', retrying: '正在重试', succeeded: '已完成', failed: '生成失败', refunded: '生成失败 · 积分已退回'
};
export function JobStatus({ status }: { status: string }) {
  const working = isWorking(status);
  const failed = status === 'failed' || status === 'refunded';
  return <span className={`job-status ${failed ? 'is-error' : ''}`} role="status" aria-label={statusLabels[status] ?? status}>
    {working ? <span className="job-progress-dots" aria-hidden="true"><i /><i /><i /></span> : failed ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
    {!working && (statusLabels[status] ?? status)}
  </span>;
}

export function Canvas({ job, editingJobId, files, loading, error, onUpload, onPreview, onContinue, onRetry, continuing }: {
  job?: ImageJobRecord; editingJobId?: string; files: UploadedFileRecord[]; loading: boolean; error?: string;
  onUpload: () => void; onPreview: (images: PreviewImage[], index: number) => void;
  onContinue: (index: number) => void; onRetry: () => void; continuing: boolean;
}) {
  const [index, setIndex] = useState(0);
  const outputs = job?.outputImages ?? [];
  const inputs = job?.inputFiles.length ? job.inputFiles : files;
  const source = inputs[0];
  const result = outputs[index] ?? outputs[0];
  const current = result ?? source;
  const failed = job?.status === 'failed' || job?.status === 'refunded';
  const working = isWorking(job?.status) || loading;
  useEffect(() => { setIndex(0); }, [job?.id]);
  const inputPreviews = inputs.map((file, i) => ({
    url: file.url,
    label: `参考图 ${i + 1}`,
    alt: `${job?.prompt || '本轮任务'}的参考图 ${i + 1}`,
    meta: `${job?.id ?? 'draft'}:input:${file.id}`
  }));
  const outputPreviews = outputs.map((image, i) => ({
    url: image.url, label: `结果 ${i + 1}`, alt: job?.prompt || `结果 ${i + 1}`,
    meta: `${job?.id}:output:${i}`,
    downloadUrl: `/api/image/jobs/${job!.id}/download/${i}`
  }));
  const previews = [...inputPreviews, ...outputPreviews];
  const currentPreviewIndex = result ? inputPreviews.length + index : 0;
  return <section className="studio-canvas" aria-label="图片工作区">
    {(job || error || loading) && <div className="canvas-status">
      {job ? <JobStatus status={job.status} /> : loading ? <span className="job-progress-dots" aria-label="正在恢复任务"><i /><i /><i /></span> : null}
      {job && result && <span className="canvas-parameters">{job.quality} · {job.selectedModel}</span>}
      {error && <span role="alert" className="text-red-700">连接中断，正在重试</span>}
    </div>}
    <div className="canvas-stage">
      {current ? <div className="canvas-image-space" onClick={() => previews.length && onPreview(previews, currentPreviewIndex)} role="button" tabIndex={0} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && previews.length) onPreview(previews, currentPreviewIndex); }}>
        <img src={current.url} alt={job?.prompt || '参考图'} draggable={false} />
        {result && <a className="canvas-download" href={`/api/image/jobs/${job!.id}/download/${index}`} download title="下载图片" aria-label="下载图片" onClick={event => event.stopPropagation()}><Download size={17} /></a>}
      {job && <div className="canvas-image-meta">{result && <span>{job.quality} · {job.selectedModel}</span>}</div>}
      </div> : <div className="canvas-empty">
        <button className="empty-upload" onClick={onUpload} aria-label="添加参考图"><ImagePlus size={36} strokeWidth={1.4} /></button>
        {!working && <h1>{failed ? '这次生成未完成' : '开始一张新作品'}</h1>}
        {working && <div className="canvas-generating" role="status" aria-label="图片生成中"><span /><span /><span /></div>}
        {!working && !failed && <button className="studio-secondary" onClick={onUpload}>添加参考图</button>}
      </div>}
      {working && current && <div className="canvas-generating canvas-generating-overlay" role="status" aria-label="图片生成中"><span /><span /><span /></div>}
    </div>
    {failed && <div className="canvas-error" role="alert"><p>{userMessage(job.error?.message || '生成失败，请稍后重试')}</p>
      <button className="studio-secondary" onClick={onRetry}><RefreshCw size={16} /> 修改后重试</button>
    </div>}
    {outputs.length > 1 && <div className="canvas-thumbnails">
      {outputs.map((image, i) => <button key={`${image.url}-${i}`}
        className={index === i ? 'selected' : ''} aria-label={`选择结果 ${i + 1}`}
        onClick={() => setIndex(i)}>
        <img src={image.url} alt="" loading="lazy" />
      </button>)}
    </div>}
    {result && <div className={`canvas-result-footer ${editingJobId === job?.id && outputs.length === 1 ? 'is-editing' : ''}`}><span>{result.width && result.height ? `${result.width} × ${result.height}` : ''}</span>
      {(editingJobId !== job?.id || outputs.length > 1) && <button className="studio-secondary" onClick={() => onContinue(index)} disabled={continuing}>{continuing && <Loader2 size={16} className="animate-spin" />}继续编辑</button>}
    </div>}
  </section>;
}
