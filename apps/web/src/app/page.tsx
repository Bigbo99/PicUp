'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileImage,
  History,
  Loader2,
  LogOut,
  RefreshCw,
  Trash2,
  UploadCloud,
  UserCircle,
  Wand2,
  X
} from 'lucide-react';
import {
  aspectRatioOptions,
  resolutionOptions,
  templateOptions,
  type ImageJobRecord,
  type ImageProviderName,
  type ImageQuality,
  type ImageTemplate,
  type UploadedFileRecord
} from '@picup/shared';
import { createImageJob, deleteImageJob, getImageJob, getMe, getModels, listImageJobs, logout, uploadImage } from '@/lib/api';

const FALLBACK_REFERENCE_LIMIT = 14;

type PreviewImage = {
  url: string;
  label: string;
  alt: string;
  meta?: string;
};

type LightboxState = {
  title: string;
  images: PreviewImage[];
  index: number;
};

function normalizeResolution(value: unknown): ImageQuality {
  if (value === '512' || value === '1K' || value === '2K' || value === '4K') return value;
  if (value === 'preview') return '512';
  if (value === 'hd') return '2K';
  if (value === 'pro') return '4K';
  return '1K';
}

export default function HomePage() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<UploadedFileRecord[]>([]);
  const [template, setTemplate] = useState<ImageTemplate>('replace_text');
  const [prompt, setPrompt] = useState('把图片里的文字改成夏日新品，其他不变');
  const [provider, setProvider] = useState<ImageProviderName>('auto');
  const [model, setModel] = useState('auto');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [quality, setQuality] = useState<ImageQuality>('1K');
  const [jobId, setJobId] = useState<string | null>(null);
  const [viewingJob, setViewingJob] = useState<ImageJobRecord | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meQuery = useQuery({ queryKey: ['me'], queryFn: getMe });
  const modelsQuery = useQuery({ queryKey: ['models'], queryFn: getModels });
  const historyQuery = useQuery({ queryKey: ['jobs'], queryFn: listImageJobs, refetchInterval: 8000 });
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getImageJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'succeeded' || status === 'failed' || status === 'refunded' ? false : 2000;
    }
  });

  const modelOptions = useMemo(() => modelsQuery.data?.models.filter((item) => item.enabled) ?? [], [modelsQuery.data]);
  const selectedModelConfig = useMemo(() => {
    if (provider !== 'auto' && model !== 'auto') {
      return modelOptions.find((item) => item.provider === provider && item.model === model);
    }
    return modelOptions.find((item) => item.model === modelsQuery.data?.defaultModel) ?? modelOptions[0];
  }, [model, modelOptions, modelsQuery.data?.defaultModel, provider]);

  const availableRatios = useMemo(() => {
    const supported = selectedModelConfig?.supportedRatios;
    return supported ? aspectRatioOptions.filter((item) => supported.includes(item.value)) : aspectRatioOptions;
  }, [selectedModelConfig]);

  const availableResolutions = useMemo(() => {
    const supported = selectedModelConfig?.supportedQualities;
    return supported ? resolutionOptions.filter((item) => supported.includes(item.value)) : resolutionOptions;
  }, [selectedModelConfig]);

  const maxReferenceImages = selectedModelConfig?.maxInputImages ?? FALLBACK_REFERENCE_LIMIT;
  const referenceLimitError = uploaded.length > maxReferenceImages
    ? `当前模型最多支持 ${maxReferenceImages} 张参考图，请删除多余图片后再生成`
    : null;

  useEffect(() => {
    if (availableRatios.length > 0 && !availableRatios.some((item) => item.value === aspectRatio)) {
      setAspectRatio(availableRatios[0].value);
    }
  }, [aspectRatio, availableRatios]);

  useEffect(() => {
    if (availableResolutions.length > 0 && !availableResolutions.some((item) => item.value === quality)) {
      setQuality(availableResolutions[0].value);
    }
  }, [availableResolutions, quality]);

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => Promise.all(files.map((file) => uploadImage(file))),
    onSuccess: (files) => {
      setUploaded((items) => [...items, ...files]);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : '上传失败')
  });

  const createJobMutation = useMutation({
    mutationFn: createImageJob,
    onSuccess: (result) => {
      setJobId(result.jobId);
      setViewingJob(null);
      setError(null);
      historyQuery.refetch();
      meQuery.refetch();
    },
    onError: (err) => setError(err instanceof Error ? err.message : '任务创建失败')
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
    }
  });

  const deleteJobMutation = useMutation({
    mutationFn: deleteImageJob,
    onSuccess: async (result) => {
      if (viewingJob?.id === result.jobId) setViewingJob(null);
      if (jobId === result.jobId) setJobId(null);
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['job', result.jobId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : '删除任务失败')
  });

  const currentJob = jobQuery.data;
  const previewJob = viewingJob ?? currentJob ?? null;
  const isViewingHistory = Boolean(viewingJob);
  const canSubmit = prompt.trim().length > 0
    && !createJobMutation.isPending
    && !uploadMutation.isPending
    && !referenceLimitError;
  const activeTemplate = templateOptions.find((item) => item.value === template);

  function handleFiles(files?: FileList | File[]) {
    const nextFiles = Array.from(files ?? []);
    if (nextFiles.length === 0) return;

    const availableSlots = maxReferenceImages - uploaded.length;
    if (availableSlots <= 0) {
      setError(`当前模型最多支持 ${maxReferenceImages} 张参考图`);
      return;
    }

    const acceptedFiles = nextFiles.slice(0, availableSlots);
    if (acceptedFiles.length < nextFiles.length) {
      setError(`已按当前模型上限保留前 ${acceptedFiles.length} 张图片`);
    }
    uploadMutation.mutate(acceptedFiles);
  }

  function submit() {
    if (!canSubmit) return;
    createJobMutation.mutate({
      mode: uploaded.length > 0 ? 'edit' : 'generate',
      provider,
      model,
      template,
      prompt,
      imageIds: uploaded.map((file) => file.id),
      aspectRatio,
      quality
    });
  }

  function viewHistoryJob(job: ImageJobRecord) {
    setJobId(job.id);
    setViewingJob(job);
    setIsHistoryOpen(false);
  }

  function continueFrom(job: ImageJobRecord) {
    setJobId(job.id);
    setViewingJob(null);
    setTemplate(job.template);
    setPrompt(job.prompt);
    setProvider(job.provider);
    setModel(job.model);
    setAspectRatio(job.aspectRatio);
    setQuality(normalizeResolution(job.quality));
    setUploaded(job.inputFiles);
    setIsHistoryOpen(false);
  }

  function returnToLatest() {
    setViewingJob(null);
    if (currentJob) setJobId(currentJob.id);
  }

  function deleteHistoryJob(job: ImageJobRecord) {
    const ok = window.confirm('删除后将从历史任务中移除，是否继续？');
    if (!ok) return;
    deleteJobMutation.mutate(job.id);
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white">
              <Wand2 aria-hidden size={22} />
            </div>
            <div>
              <p className="text-lg font-bold leading-tight">PicUp</p>
              <p className="hidden text-sm text-muted sm:block">AI 图片生成与编辑工作台</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {meQuery.data?.user.isGuest ? (
              <Link
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700"
                href="/login"
              >
                <UserCircle size={18} aria-hidden />
                登录
              </Link>
            ) : (
              <button
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                <LogOut size={18} aria-hidden />
                退出
              </button>
            )}
            <button
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700 lg:hidden"
              onClick={() => setIsHistoryOpen(true)}
            >
              <History size={18} aria-hidden />
              历史
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1720px] gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:grid-cols-[380px_minmax(0,1fr)_320px] xl:grid-cols-[400px_minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-line bg-white p-4 shadow-panel lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
          <div className="mb-4">
            <h1 className="text-2xl font-bold leading-tight">上传参考图，描述你想要的结果</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              当前选项会按模型能力自动收窄，包括比例、分辨率和参考图数量。
            </p>
          </div>

          <button
            className="flex min-h-[148px] w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-slate-50 px-4 text-center transition-colors hover:border-teal-600 hover:bg-teal-50"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleFiles(event.dataTransfer.files);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => handleFiles(event.target.files ?? undefined)}
            />
            {uploadMutation.isPending ? (
              <Loader2 className="mb-3 animate-spin text-teal-700" size={28} aria-hidden />
            ) : (
              <UploadCloud className="mb-3 text-teal-700" size={30} aria-hidden />
            )}
            <span className="font-semibold">点击或拖拽上传参考图</span>
            <span className="mt-1 text-sm text-muted">JPG、PNG、WEBP，当前模型最多 {maxReferenceImages} 张</span>
          </button>

          {uploaded.length > 0 && (
            <div className="mt-3 grid gap-2">
              {uploaded.map((file, index) => (
                <div key={file.id} className="flex items-center gap-3 rounded-lg border border-line bg-white p-3">
                  <FileImage className="shrink-0 text-teal-700" size={22} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">参考图 {index + 1}</p>
                    <p className="text-xs text-muted">{Math.round(file.size / 1024)} KB</p>
                  </div>
                  <button
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-red-300 hover:text-red-600"
                    onClick={() => setUploaded((items) => items.filter((item) => item.id !== file.id))}
                    aria-label={`删除参考图 ${index + 1}`}
                    title="删除"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5">
            <label className="mb-2 block text-sm font-semibold">P 图类型</label>
            <div className="grid grid-cols-2 gap-2">
              {templateOptions.map((item) => (
                <button
                  key={item.value}
                  className={`min-h-11 cursor-pointer rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    template === item.value
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-line bg-white hover:border-teal-600'
                  }`}
                  onClick={() => setTemplate(item.value)}
                >
                  <span className="block font-semibold">{item.label}</span>
                  <span className="mt-1 block truncate text-xs text-muted">{item.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <label htmlFor="prompt" className="mb-2 block text-sm font-semibold">
              编辑指令
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-lg border border-line bg-white px-3 py-3 text-base leading-6 text-ink shadow-sm"
              placeholder="例如：把背景换成白色，保留商品不变"
            />
            <p className="mt-2 text-xs text-muted">{activeTemplate?.description}</p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">模型通道</span>
              <select
                value={`${provider}:${model}`}
                onChange={(event) => {
                  const [nextProvider, nextModel] = event.target.value.split(':') as [ImageProviderName, string];
                  setProvider(nextProvider);
                  setModel(nextModel);
                }}
                className="min-h-11 w-full cursor-pointer rounded-lg border border-line bg-white px-3"
              >
                <option value="auto:auto">自动推荐</option>
                {modelOptions.map((item) => (
                  <option key={`${item.provider}:${item.model}`} value={`${item.provider}:${item.model}`}>
                    {item.displayName}
                  </option>
                ))}
              </select>
              {selectedModelConfig && (
                <span className="mt-1 block text-xs text-muted">{selectedModelConfig.description}</span>
              )}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">图片比例</span>
              <select
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value)}
                className="min-h-11 w-full cursor-pointer rounded-lg border border-line bg-white px-3"
              >
                {availableRatios.map((item) => (
                  <option key={item.value} value={item.value}>{item.label} {item.value}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold">分辨率</span>
              <select
                value={quality}
                onChange={(event) => setQuality(event.target.value as ImageQuality)}
                className="min-h-11 w-full cursor-pointer rounded-lg border border-line bg-white px-3"
              >
                {availableResolutions.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>

          {(error || referenceLimitError) && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {referenceLimitError ?? error}
            </div>
          )}

          <button
            disabled={!canSubmit}
            onClick={submit}
            className="mt-5 inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {createJobMutation.isPending ? <Loader2 className="animate-spin" size={20} aria-hidden /> : <Wand2 size={20} aria-hidden />}
            开始生成
          </button>
        </section>

        <section className="min-w-0">
          <ResultPanel
            uploaded={isViewingHistory ? previewJob?.inputFiles ?? [] : uploaded}
            job={previewJob}
            loading={Boolean(jobId && jobQuery.isFetching && !previewJob)}
            isViewingHistory={isViewingHistory}
            onContinueEdit={previewJob ? () => continueFrom(previewJob) : undefined}
            onReturnLatest={isViewingHistory ? returnToLatest : undefined}
          />
        </section>

        <HistoryPanel
          jobs={historyQuery.data ?? []}
          activeJobId={previewJob?.id ?? null}
          onView={viewHistoryJob}
          onContinue={continueFrom}
          onDelete={deleteHistoryJob}
          deletingJobId={deleteJobMutation.variables ?? null}
          variant="sidebar"
        />
      </div>

      <HistoryDrawer
        open={isHistoryOpen}
        jobs={historyQuery.data ?? []}
        activeJobId={previewJob?.id ?? null}
        onClose={() => setIsHistoryOpen(false)}
        onView={viewHistoryJob}
        onContinue={continueFrom}
        onDelete={deleteHistoryJob}
        deletingJobId={deleteJobMutation.variables ?? null}
      />
    </main>
  );
}

function ResultPanel({
  uploaded,
  job,
  loading,
  isViewingHistory,
  onContinueEdit,
  onReturnLatest
}: {
  uploaded: UploadedFileRecord[];
  job: ImageJobRecord | null;
  loading: boolean;
  isViewingHistory: boolean;
  onContinueEdit?: () => void;
  onReturnLatest?: () => void;
}) {
  const output = job?.outputImages[0];
  const isWorking = job?.status === 'queued' || job?.status === 'running' || job?.status === 'retrying' || loading;
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const referenceImages = uploaded.map((file, index) => ({
    url: file.url,
    label: `参考图 ${index + 1}`,
    alt: `参考图 ${index + 1} 预览`,
    meta: file.width && file.height ? `${file.width} x ${file.height}` : `${Math.round(file.size / 1024)} KB`
  }));
  const resultImages = (job?.outputImages ?? []).map((image, index) => ({
    url: image.url,
    label: `结果图 ${index + 1}`,
    alt: `结果图 ${index + 1} 预览`,
    meta: image.width && image.height ? `${image.width} x ${image.height}` : undefined
  }));

  return (
    <section className="rounded-lg border border-line bg-white p-3 shadow-panel sm:p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{isViewingHistory ? '正在查看历史任务' : '当前任务预览'}</h2>
            {isViewingHistory && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                未覆盖当前编辑
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {isViewingHistory
              ? '历史查看只切换预览区，点击继续编辑才会载入左侧参数。'
              : '左侧显示全部参考图，右侧显示模型结果；点击图片可放大查看。'}
          </p>
        </div>
        {job && <StatusBadge status={job.status} />}
      </div>

      {isViewingHistory && job && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="line-clamp-2 text-sm font-semibold text-amber-900">{job.prompt}</p>
          <p className="mt-1 text-xs text-amber-700">
            {new Date(job.createdAt).toLocaleString()} · {job.selectedProvider} · {normalizeResolution(job.quality)}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <PreviewBox
          title="参考图"
          images={referenceImages}
          emptyText="上传参考图后显示预览；不上传也可以直接文生图。"
          onOpen={(index) => setLightbox({ title: '参考图预览', images: referenceImages, index })}
        />
        <PreviewBox
          title="结果图"
          images={resultImages}
          emptyText={isWorking ? '模型正在处理，请稍候。' : '生成完成后结果会显示在这里。'}
          working={isWorking}
          onOpen={(index) => setLightbox({ title: '结果图预览', images: resultImages, index })}
        />
      </div>

      {job?.status === 'failed' && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {job.error?.message ?? '生成失败，请稍后重试'}
        </div>
      )}

      {output && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <a
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 font-semibold text-white transition-colors hover:bg-teal-700"
            href={output.url}
            download
            target="_blank"
          >
            <Download size={18} aria-hidden />
            下载结果
          </a>
          <button
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700"
            onClick={onContinueEdit}
          >
            <RefreshCw size={18} aria-hidden />
            继续编辑
          </button>
          {onReturnLatest && (
            <button
              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-white px-4 font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700"
              onClick={onReturnLatest}
            >
              返回当前任务
            </button>
          )}
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          title={lightbox.title}
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((current) => current ? { ...current, index } : current)}
          onClose={() => setLightbox(null)}
        />
      )}
    </section>
  );
}

function PreviewBox({
  title,
  images,
  emptyText,
  working,
  onOpen
}: {
  title: string;
  images: PreviewImage[];
  emptyText: string;
  working?: boolean;
  onOpen: (index: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-slate-50">
      <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3 text-sm font-semibold">
        <span>{title}</span>
        {images.length > 0 && <span className="text-xs font-medium text-muted">{images.length} 张</span>}
      </div>
      <div className="min-h-[220px] p-2 sm:min-h-[280px] sm:p-3">
        {images.length > 0 ? (
          <div className={`grid gap-2 sm:gap-3 ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3'}`}>
            {images.map((image, index) => (
              <button
                key={`${image.url}-${index}`}
                type="button"
                className="group cursor-pointer overflow-hidden rounded-lg border border-line bg-white text-left shadow-sm transition-colors hover:border-teal-600 focus-visible:border-teal-600"
                onClick={() => onOpen(index)}
                aria-label={`打开${image.label}`}
              >
                <span
                  className={`flex items-center justify-center bg-slate-100 p-2 ${
                    images.length === 1
                      ? 'h-[clamp(260px,58vh,560px)]'
                      : 'aspect-[4/5] min-[420px]:aspect-square'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={image.alt} className="max-h-full max-w-full rounded-md object-contain" />
                </span>
                <span className="flex min-h-11 items-center justify-between gap-2 border-t border-line px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{image.label}</span>
                    {image.meta && <span className="block truncate text-xs text-muted">{image.meta}</span>}
                  </span>
                  <Eye className="shrink-0 text-muted transition-colors group-hover:text-teal-700" size={17} aria-hidden />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[216px] items-center justify-center sm:min-h-[256px]">
            <div className="max-w-sm text-center text-sm leading-6 text-muted">
              {working && <Loader2 className="mx-auto mb-3 animate-spin text-teal-700" size={28} aria-hidden />}
              {emptyText}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ImageLightbox({
  title,
  images,
  index,
  onIndexChange,
  onClose
}: {
  title: string;
  images: PreviewImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];
  const hasMultiple = images.length > 1;

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && hasMultiple) {
        onIndexChange((index - 1 + images.length) % images.length);
      }
      if (event.key === 'ArrowRight' && hasMultiple) {
        onIndexChange((index + 1) % images.length);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasMultiple, images.length, index, onClose, onIndexChange]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-slate-950/90 p-2 text-white sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="mx-auto grid h-full min-h-0 w-full max-w-7xl grid-rows-[auto_minmax(0,1fr)_auto] gap-2 sm:gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-slate-950/80 px-2 py-2 sm:bg-transparent sm:px-0 sm:py-0">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{title}</p>
            <p className="text-sm text-slate-300">{index + 1} / {images.length} · {image.label}</p>
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/20 bg-white/10 transition-colors hover:bg-white/20"
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭"
          >
            <X size={22} aria-hidden />
          </button>
        </div>

        <div className="relative flex min-h-0 items-center justify-center overflow-hidden rounded-lg bg-black/25">
          {hasMultiple && (
            <button
              type="button"
              className="absolute left-2 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg border border-white/20 bg-slate-950/70 transition-colors hover:bg-white/20 sm:left-3"
              onClick={() => onIndexChange((index - 1 + images.length) % images.length)}
              aria-label="查看上一张"
              title="上一张"
            >
              <ChevronLeft size={26} aria-hidden />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.alt} className="h-full w-full object-contain shadow-2xl" />
          {hasMultiple && (
            <button
              type="button"
              className="absolute right-2 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg border border-white/20 bg-slate-950/70 transition-colors hover:bg-white/20 sm:right-3"
              onClick={() => onIndexChange((index + 1) % images.length)}
              aria-label="查看下一张"
              title="下一张"
            >
              <ChevronRight size={26} aria-hidden />
            </button>
          )}
        </div>

        {hasMultiple && (
          <div className="flex max-w-full gap-2 overflow-x-auto rounded-lg bg-slate-950/60 p-2 sm:bg-transparent sm:p-0">
            {images.map((item, itemIndex) => (
              <button
                key={`${item.url}-${itemIndex}`}
                type="button"
                className={`h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border transition-colors sm:h-16 sm:w-16 ${
                  itemIndex === index ? 'border-teal-300' : 'border-white/20 hover:border-white/60'
                }`}
                onClick={() => onIndexChange(itemIndex)}
                aria-label={`查看${item.label}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.alt} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ImageJobRecord['status'] }) {
  const map = {
    queued: '排队中',
    running: '生成中',
    retrying: '重试中',
    succeeded: '已完成',
    failed: '失败',
    refunded: '已返还'
  };
  const done = status === 'succeeded';
  return (
    <span className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold ${done ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-muted'}`}>
      {done ? <CheckCircle2 size={16} aria-hidden /> : <Loader2 size={16} className={status === 'failed' ? '' : 'animate-spin'} aria-hidden />}
      {map[status]}
    </span>
  );
}

function HistoryPanel({
  jobs,
  activeJobId,
  onView,
  onContinue,
  onDelete,
  deletingJobId,
  variant
}: {
  jobs: ImageJobRecord[];
  activeJobId: string | null;
  onView: (job: ImageJobRecord) => void;
  onContinue: (job: ImageJobRecord) => void;
  onDelete: (job: ImageJobRecord) => void;
  deletingJobId: string | null;
  variant: 'sidebar' | 'drawer';
}) {
  return (
    <section
      id="history"
      className={`rounded-lg border border-line bg-white p-4 shadow-panel ${
        variant === 'sidebar' ? 'hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden' : ''
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">历史任务</h2>
          <p className="mt-1 text-xs text-muted">点击查看，不覆盖编辑</p>
        </div>
        <span className="text-sm text-muted">{jobs.length} 条</span>
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
          生成任务会出现在这里。
        </div>
      ) : (
        <div className={`${variant === 'sidebar' ? 'max-h-[calc(100vh-11rem)] overflow-y-auto pr-1' : ''} grid gap-3`}>
          {jobs.map((job) => (
            <article
              key={job.id}
              className={`rounded-lg border bg-white p-3 transition-colors ${
                activeJobId === job.id ? 'border-teal-600 ring-2 ring-teal-100' : 'border-line hover:border-teal-600'
              }`}
            >
              <button
                className="block w-full cursor-pointer text-left"
                onClick={() => onView(job)}
                aria-label={`查看历史任务：${job.prompt}`}
              >
                <div className="mb-3 aspect-[4/3] overflow-hidden rounded-md bg-slate-100">
                {job.outputImages[0]?.url || job.inputFiles[0]?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={job.outputImages[0]?.url ?? job.inputFiles[0]?.url}
                    alt="历史任务缩略图"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted">等待结果</div>
                )}
                </div>
                <p className="line-clamp-2 text-sm font-semibold leading-5">{job.prompt}</p>
                <p className="mt-1 text-xs text-muted">{job.selectedProvider} / {job.status} / {normalizeResolution(job.quality)}</p>
              </button>
              <div className="mt-3 grid grid-cols-[1fr_1fr_40px] gap-2">
                <button
                  className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold transition-colors hover:border-teal-600 hover:text-teal-700"
                  onClick={() => onView(job)}
                >
                  <Eye size={15} aria-hidden />
                  查看
                </button>
                <button
                  className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
                  onClick={() => onContinue(job)}
                >
                  <RefreshCw size={15} aria-hidden />
                  编辑
                </button>
                <button
                  className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition-colors hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => onDelete(job)}
                  disabled={deletingJobId === job.id}
                  aria-label={`删除历史任务：${job.prompt}`}
                  title="删除"
                >
                  {deletingJobId === job.id ? <Loader2 className="animate-spin" size={15} aria-hidden /> : <Trash2 size={15} aria-hidden />}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryDrawer({
  open,
  jobs,
  activeJobId,
  onClose,
  onView,
  onContinue,
  onDelete,
  deletingJobId
}: {
  open: boolean;
  jobs: ImageJobRecord[];
  activeJobId: string | null;
  onClose: () => void;
  onView: (job: ImageJobRecord) => void;
  onContinue: (job: ImageJobRecord) => void;
  onDelete: (job: ImageJobRecord) => void;
  deletingJobId: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/45 lg:hidden" role="dialog" aria-modal="true" aria-label="历史任务">
      <button className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="关闭历史任务" />
      <div className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-hidden rounded-t-2xl bg-white shadow-2xl">
        <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <div>
            <p className="font-bold">历史任务</p>
            <p className="text-xs text-muted">点击查看，不覆盖当前编辑</p>
          </div>
          <button
            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-teal-600 hover:text-teal-700"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="max-h-[calc(86dvh-3.5rem)] overflow-y-auto p-3">
          <HistoryPanel
            jobs={jobs}
            activeJobId={activeJobId}
            onView={onView}
            onContinue={onContinue}
            onDelete={onDelete}
            deletingJobId={deletingJobId}
            variant="drawer"
          />
        </div>
      </div>
    </div>
  );
}
