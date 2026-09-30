'use client';

import { thumbnailUrl } from '@/lib/thumbnail';

import { useEffect, useState } from 'react';
import { Download, ImagePlus, Loader2, RefreshCw, CheckCircle2, AlertCircle, Pencil } from 'lucide-react';
import type { ImageJobRecord, UploadedFileRecord } from '@picup/shared';
import type { PreviewImage } from './image-lightbox';
import { userMessage } from '@/lib/user-message';
import { ImageParameters } from './image-parameters';

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

export function JobBatchStatus({ job }: { job: ImageJobRecord }) {
  const count = job.count ?? 1;
  if (count <= 1) return null;
  const completed = job.outputImages.length;
  const partial = job.status === 'succeeded' && job.error?.code === 'BATCH_PARTIAL_FAILURE';
  const label = isWorking(job.status) ? `已生成 ${completed}/${count} 张` : partial
    ? `已生成 ${completed}/${count} 张，${count - completed} 张未完成${job.creditsRefunded ? `，已退回 ${job.creditsRefunded} 积分` : ''}`
    : job.status === 'succeeded' ? `已生成 ${completed} 张` : null;
  return label ? <span className="canvas-batch-status" role="status">{label}</span> : null;
}

export function JobResultDetails({ job }: { job: ImageJobRecord }) {
  if (!job.outputImages.length && !isWorking(job.status)) return null;
  return <div className="canvas-result-details"><ImageParameters job={job} /><JobBatchStatus job={job} /></div>;
}

export function Canvas({ job, files, loading, error, onUpload, onPreview, onContinue, onRetry, continuing }: {
  job?: ImageJobRecord; files: UploadedFileRecord[]; loading: boolean; error?: string;
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
    url: file.url, thumbnailUrl: thumbnailUrl(file),
    label: `参考图 ${i + 1}`,
    alt: `${job?.prompt || '本轮任务'}的参考图 ${i + 1}`,
    meta: `${job?.id ?? 'draft'}:input:${file.id}`
  }));
  const outputPreviews = outputs.map((image, i) => {
    const slotIndex = job?.outputProgress?.findIndex(slot => slot.outputIndex === i) ?? -1;
    return {
      url: image.url, thumbnailUrl: thumbnailUrl(image), label: `结果 ${slotIndex >= 0 ? slotIndex + 1 : i + 1}`, alt: job?.prompt || `结果 ${i + 1}`,
      meta: `${job?.id}:output:${i}`,
      downloadUrl: `/api/image/jobs/${job!.id}/download/${i}`
    };
  });
  const previews = [...inputPreviews, ...outputPreviews];
  const currentPreviewIndex = result ? inputPreviews.length + index : 0;
  if (job && (job.count ?? 1) > 1) {
    const slots = Array.from({ length: job.count! }, (_, i) => {
      const progress = job.outputProgress?.[i];
      const outputIndex = progress?.outputIndex ?? (!job.outputProgress?.length && outputs[i] ? i : undefined);
      const output = outputIndex === undefined ? undefined : outputs[outputIndex];
      const status = output ? 'succeeded' : !isWorking(job.status) ? 'failed' : progress?.status ?? (job.status === 'running' ? 'running' : 'queued');
      return { output, outputIndex, status };
    });
    return <section className="studio-canvas canvas-batch" aria-label="图片工作区">
      <div className="canvas-status"><JobStatus status={job.status} />{error && <span role="alert">连接中断，正在重试</span>}</div>
      <div className="canvas-batch-grid" data-count={job.count}>
        {slots.map(({ output, outputIndex, status }, i) => <div key={`${job.id}-${i}`} className="canvas-batch-slot" data-status={status} aria-label={`第 ${i + 1} 张图片`} aria-busy={status === 'queued' || status === 'running'}>
          {output && outputIndex !== undefined ? <>
            <button type="button" className="canvas-batch-preview" aria-label={`预览结果 ${i + 1}`} onClick={() => onPreview(previews, inputPreviews.length + outputIndex)}><img src={thumbnailUrl(output)} alt={`${job.prompt}，结果 ${i + 1}`} draggable={false} /></button>
            <div className="canvas-batch-actions">
              <a className="studio-icon" href={`/api/image/jobs/${job.id}/download/${outputIndex}`} download aria-label={`下载结果 ${i + 1}`} title="下载图片"><Download size={16} /></a>
              <button type="button" className="studio-icon" aria-label={`继续编辑结果 ${i + 1}`} title={working ? '整批完成后继续编辑' : '继续编辑'} disabled={continuing || working} onClick={() => onContinue(outputIndex)}><Pencil size={16} /></button>
            </div>
          </> : <>
            {job.inputFiles[0] && <img className="canvas-batch-reference" src={thumbnailUrl(job.inputFiles[0])} alt="" aria-hidden="true" />}
            <div className="canvas-batch-mask" role="status">
              {status === 'failed' ? <AlertCircle size={22} /> : <Loader2 size={22} className="animate-spin" />}
              <span>{status === 'failed' ? '生成失败' : status === 'queued' ? '排队中' : '生成中'}</span>
            </div>
          </>}
          <span className="canvas-batch-number">{i + 1}</span>
        </div>)}
      </div>
      <JobResultDetails job={job} />
      {failed && <div className="canvas-error" role="alert"><p>{userMessage(job.error?.message || '生成失败，请稍后重试')}</p><button className="studio-secondary" onClick={onRetry}><RefreshCw size={16} /> 修改后重试</button></div>}
    </section>;
  }
  return <section className="studio-canvas" aria-label="图片工作区">
    {(job || error || loading) && <div className="canvas-status">
      {job ? <JobStatus status={job.status} /> : loading ? <span className="job-progress-dots" aria-label="正在恢复任务"><i /><i /><i /></span> : null}
      {error && <span role="alert" className="text-red-700">连接中断，正在重试</span>}
    </div>}
    <div className="canvas-stage">
      {current ? <div className="canvas-image-space" onClick={() => previews.length && onPreview(previews, currentPreviewIndex)} role="button" tabIndex={0} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && previews.length) onPreview(previews, currentPreviewIndex); }}>
        <img src={thumbnailUrl(current)} alt={job?.prompt || '参考图'} draggable={false} />
        {result && <a className="canvas-download" href={`/api/image/jobs/${job!.id}/download/${index}`} download title="下载图片" aria-label="下载图片" onClick={event => event.stopPropagation()}><Download size={17} /></a>}
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
    {job && <JobResultDetails job={job} />}
    {outputs.length > 1 && <div className="canvas-thumbnails">
      {outputs.map((image, i) => <div className="canvas-thumbnail" key={`${image.url}-${i}`}>
        <button className={index === i ? 'selected' : ''} aria-label={`选择结果 ${i + 1}`} aria-pressed={index === i} onClick={() => setIndex(i)}>
          <img src={thumbnailUrl(image)} alt="" loading="lazy" />
        </button>
        <button className="canvas-thumbnail-edit" type="button" aria-label={`继续编辑结果 ${i + 1}`} title="继续编辑" onClick={() => onContinue(i)} disabled={continuing}><Pencil size={14} /></button>
      </div>)}
    </div>}
    {result && <div className="canvas-result-footer"><span>{[outputs.length > 1 ? `结果 ${index + 1}/${outputs.length}` : '', result.width && result.height ? `${result.width} × ${result.height}` : ''].filter(Boolean).join(' · ')}</span>
      <button className="studio-secondary" onClick={() => onContinue(index)} disabled={continuing}>{continuing && <Loader2 size={16} className="animate-spin" />}继续编辑</button>
    </div>}
  </section>;
}
