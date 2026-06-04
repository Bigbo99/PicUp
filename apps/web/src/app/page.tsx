'use client';

import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
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
  type ModelConfig,
  type ImageProviderName,
  type ImageQuality,
  type ImageTemplate,
  type UploadedFileRecord
} from '@picup/shared';
import { createImageJob, deleteImageJob, getImageJob, getMe, getModels, listImageJobs, logout, uploadImage } from '@/lib/api';
import { useNotifications } from '@/components/notification-provider';

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

type MobileTab = 'create' | 'detail' | 'history' | 'account';

function normalizeResolution(value: unknown): ImageQuality {
  if (value === '512' || value === '1K' || value === '2K' || value === '4K') return value;
  if (value === 'preview') return '512';
  if (value === 'hd') return '2K';
  if (value === 'pro') return '4K';
  return '1K';
}

function statusLabel(status: ImageJobRecord['status']) {
  const map: Record<ImageJobRecord['status'], string> = {
    queued: '排队中',
    running: '生成中',
    retrying: '重试中',
    succeeded: '成功',
    failed: '失败',
    refunded: '已返还'
  };
  return map[status];
}

function formatJobMeta(job: ImageJobRecord) {
  const ratio = job.aspectRatio === 'auto' ? '原图比例' : job.aspectRatio;
  return `${job.selectedProvider} / ${statusLabel(job.status)} / ${normalizeResolution(job.quality)}/${ratio}`;
}

function filePreviewImages(files: UploadedFileRecord[]) {
  return files.map((file, index) => ({
    url: file.url,
    label: `参考图 ${index + 1}`,
    alt: `参考图 ${index + 1} 预览`,
    meta: file.width && file.height ? `${file.width} x ${file.height}` : `${Math.round(file.size / 1024)} KB`
  }));
}

function jobLightboxImages(job: ImageJobRecord) {
  return [
    ...job.outputImages.map((image, index) => ({
      url: image.url,
      label: `结果图 ${index + 1}`,
      alt: `结果图 ${index + 1} 预览`,
      meta: image.width && image.height ? `${image.width} x ${image.height}` : undefined
    })),
    ...filePreviewImages(job.inputFiles)
  ];
}

function modelDisplayLabel(model: ModelConfig) {
  if (model.model === 'gemini-2.5-flash-image') return 'Nano Banana';
  if (model.model === 'gemini-3.1-flash-image-preview') return 'Nano Banana 2';
  if (model.model === 'gemini-3-pro-image-preview') return 'Nano Banana Pro';
  if (model.model === 'gpt-image-2' || model.model === 'gpt-image2') return 'GPT Image 2';
  return model.displayName;
}

function modelBadge(model: ModelConfig) {
  if (model.model === 'gemini-2.5-flash-image') {
    return { label: '批量・高效', tone: 'bg-teal-50 text-teal-700 border-teal-200' };
  }
  if (model.model === 'gemini-3.1-flash-image-preview') {
    return { label: '推荐・快速', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  if (model.model === 'gemini-3-pro-image-preview') {
    return { label: '推理', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  }
  if (model.model === 'gpt-image-2' || model.model === 'gpt-image2') {
    return { label: 'TokenRun・图像', tone: 'bg-rose-50 text-rose-700 border-rose-200' };
  }
  return { label: '自动', tone: 'bg-slate-50 text-slate-700 border-slate-200' };
}

function modelShortDescription(model: ModelConfig) {
  if (model.model === 'gemini-2.5-flash-image') return '适合批量与高频编辑';
  if (model.model === 'gemini-3.1-flash-image-preview') return '更快，更适合日常使用';
  if (model.model === 'gemini-3-pro-image-preview') return '更强推理，适合复杂任务';
  if (model.model === 'gpt-image-2' || model.model === 'gpt-image2') return 'TokenRun 通道，支持生成与参考图编辑';
  return model.description;
}

type DropdownOption = {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  tone?: string;
};

function DropdownSelect({
  id,
  label,
  value,
  options,
  openMenu,
  setOpenMenu,
  onChange,
  placeholder = '请选择',
  helperText
}: {
  id: string;
  label: string;
  value: string;
  options: DropdownOption[];
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((item) => item.value === value);
  const isOpen = openMenu === id;
  const [floatingStyle, setFloatingStyle] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0
  });

  useLayoutEffect(() => {
    if (!isOpen) return;

    function updatePosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const menuMaxHeight = 320;
      const belowSpace = window.innerHeight - rect.bottom - viewportPadding;
      const aboveSpace = rect.top - viewportPadding;
      const placeAbove = belowSpace < menuMaxHeight && aboveSpace > belowSpace;
      const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding));
      const top = placeAbove
        ? Math.max(viewportPadding, rect.top - viewportPadding - Math.min(menuMaxHeight, aboveSpace))
        : rect.bottom + 8;

      setFloatingStyle({
        top,
        left,
        width: rect.width
      });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [id, isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 text-left transition-colors ${
          isOpen ? 'border-teal-600 ring-2 ring-teal-100' : 'border-line hover:border-teal-600'
        }`}
        onClick={() => setOpenMenu(isOpen ? null : id)}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{selected?.label ?? placeholder}</span>
          {selected?.description && <span className="mt-0.5 block truncate text-xs text-muted">{selected.description}</span>}
        </span>
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {isOpen && createPortal(
        <div className="fixed inset-0 z-[70]">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-transparent"
            aria-label={`关闭${label}选择`}
            onClick={() => setOpenMenu(null)}
          />
          <div
            className="fixed overflow-hidden rounded-lg border border-line bg-white shadow-[0_16px_48px_rgba(15,23,42,0.18)]"
            style={{ top: floatingStyle.top, left: floatingStyle.left, width: floatingStyle.width, maxHeight: 'min(320px, calc(100vh - 24px))' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="max-h-[320px] overflow-y-auto p-1.5">
              {options.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-slate-50 ${
                    item.value === value ? 'bg-teal-50' : ''
                  }`}
                  onClick={() => {
                    onChange(item.value);
                    setOpenMenu(null);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{item.label}</span>
                    {item.description && <span className="mt-0.5 block text-xs leading-5 text-muted">{item.description}</span>}
                  </span>
                  {item.badge && (
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${item.tone ?? 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {helperText && <p className="mt-1.5 text-xs text-muted">{helperText}</p>}
    </div>
  );
}

export default function HomePage() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<UploadedFileRecord[]>([]);
  const [template, setTemplate] = useState<ImageTemplate>('replace_text');
  const [prompt, setPrompt] = useState('把图片里的文字改成夏日新品，其他不变');
  const [provider, setProvider] = useState<ImageProviderName>('auto');
  const [model, setModel] = useState('auto');
  const [aspectRatio, setAspectRatio] = useState('auto');
  const [quality, setQuality] = useState<ImageQuality>('1K');
  const [jobId, setJobId] = useState<string | null>(null);
  const [viewingJob, setViewingJob] = useState<ImageJobRecord | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('create');
  const [detailReferenceExpanded, setDetailReferenceExpanded] = useState(true);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
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
    const autoRatio = aspectRatioOptions.find((item) => item.value === 'auto');
    const supported = selectedModelConfig?.supportedRatios;
    const ratios = supported
      ? aspectRatioOptions.filter((item) => item.value !== 'auto' && supported.includes(item.value))
      : aspectRatioOptions.filter((item) => item.value !== 'auto');
    return autoRatio ? [autoRatio, ...ratios] : ratios;
  }, [selectedModelConfig]);

  const availableResolutions = useMemo(() => {
    const supported = selectedModelConfig?.supportedQualities;
    return supported ? resolutionOptions.filter((item) => supported.includes(item.value)) : resolutionOptions;
  }, [selectedModelConfig]);

  const modelChannelOptions = useMemo(() => [
    {
      value: 'auto:auto',
      label: '自动推荐',
      description: modelsQuery.data?.defaultModel ? `默认使用 ${modelsQuery.data.defaultModel}` : '根据当前任务自动选择'
    },
    ...modelOptions.map((item) => ({
      value: `${item.provider}:${item.model}`,
      label: modelDisplayLabel(item),
      description: modelShortDescription(item),
      badge: modelBadge(item).label,
      tone: modelBadge(item).tone
    }))
  ], [modelOptions, modelsQuery.data?.defaultModel]);

  const aspectRatioMenuOptions = useMemo<DropdownOption[]>(
    () => availableRatios.map((item) => ({
      value: item.value,
      label: item.label,
      description: item.value === 'auto'
        ? uploaded.length > 0 ? '优先保持参考图比例' : '不指定比例，由模型自动决定'
        : item.value
    })),
    [availableRatios, uploaded.length]
  );

  const qualityMenuOptions = useMemo<DropdownOption[]>(
    () => availableResolutions.map((item) => ({
      value: item.value,
      label: item.label,
      description: item.description
    })),
    [availableResolutions]
  );

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
      notifications.success('上传完成', `已添加 ${files.length} 张参考图`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '上传失败';
      setError(message);
      notifications.error('上传失败', message);
    }
  });

  const createJobMutation = useMutation({
    mutationFn: createImageJob,
    onSuccess: (result) => {
      setJobId(result.jobId);
      setViewingJob(null);
      setMobileTab('detail');
      setError(null);
      historyQuery.refetch();
      meQuery.refetch();
      notifications.success('任务已创建', '完成后会自动显示结果');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '任务创建失败';
      setError(message);
      notifications.error('任务创建失败', message);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      notifications.success('已退出登录');
    },
    onError: (err) => {
      notifications.error('退出失败', err instanceof Error ? err.message : '请稍后再试');
    }
  });

  const deleteJobMutation = useMutation({
    mutationFn: deleteImageJob,
    onSuccess: async (result) => {
      if (viewingJob?.id === result.jobId) setViewingJob(null);
      if (jobId === result.jobId) setJobId(null);
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['job', result.jobId] });
      notifications.success('历史任务已删除');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '删除任务失败';
      setError(message);
      notifications.error('删除失败', message);
    }
  });

  const currentJob = jobQuery.data;
  const previewJob = viewingJob ?? currentJob ?? null;
  const isViewingHistory = Boolean(viewingJob);
  const canSubmit = prompt.trim().length > 0
    && !createJobMutation.isPending
    && !uploadMutation.isPending
    && !referenceLimitError;
  const activeTemplate = templateOptions.find((item) => item.value === template);
  const isGuest = meQuery.data?.user.isGuest ?? true;

  function handleFiles(files?: FileList | File[]) {
    const nextFiles = Array.from(files ?? []);
    if (nextFiles.length === 0) return;

    const availableSlots = maxReferenceImages - uploaded.length;
    if (availableSlots <= 0) {
      const message = `当前模型最多支持 ${maxReferenceImages} 张参考图`;
      setError(message);
      notifications.warning('参考图已达上限', message);
      return;
    }

    const acceptedFiles = nextFiles.slice(0, availableSlots);
    if (acceptedFiles.length < nextFiles.length) {
      const message = `已按当前模型上限保留前 ${acceptedFiles.length} 张图片`;
      setError(message);
      notifications.warning('部分图片未加入', message);
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

  function loadJobIntoEditor(job: ImageJobRecord) {
    setTemplate(job.template);
    setPrompt(job.prompt);
    setProvider(job.provider);
    setModel(job.model);
    setAspectRatio(job.aspectRatio || 'auto');
    setQuality(normalizeResolution(job.quality));
    setUploaded(job.inputFiles);
  }

  function viewHistoryJob(job: ImageJobRecord) {
    setJobId(job.id);
    setViewingJob(job);
    setDetailReferenceExpanded(true);
    setMobileTab('detail');
  }

  function editHistoryJob(job: ImageJobRecord) {
    setJobId(job.id);
    setViewingJob(null);
    loadJobIntoEditor(job);
    setDetailReferenceExpanded(false);
    setMobileTab('create');
  }

  function returnToLatest() {
    setViewingJob(null);
    if (currentJob) setJobId(currentJob.id);
  }

  async function deleteHistoryJob(job: ImageJobRecord) {
    const ok = await notifications.confirm({
      title: '删除历史任务？',
      message: '删除后将从历史任务中移除，当前生成结果不会再出现在列表里。',
      confirmText: '删除',
      cancelText: '保留',
      tone: 'danger'
    });
    if (!ok) return;
    deleteJobMutation.mutate(job.id);
  }

  return (
    <main className="min-h-[100dvh] bg-canvas pb-[calc(4.5rem+env(safe-area-inset-bottom))] text-ink lg:flex lg:h-[100dvh] lg:flex-col lg:pb-0">
      <header className="sticky top-0 z-30 shrink-0 border-b border-line bg-white/95 backdrop-blur lg:static">
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
          <div className="hidden items-center gap-3 lg:flex">
            {isGuest ? (
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
            <ContentPlatformLink />
          </div>
        </div>
      </header>

      <div className="workbench-shell mx-auto grid gap-3 px-3 pt-3 sm:gap-4 sm:px-6 sm:pt-4 lg:min-h-0 lg:flex-1 lg:gap-5 lg:overflow-hidden lg:px-5 lg:pb-3 lg:pt-3 xl:px-6">
        <section className={`${mobileTab === 'create' ? 'flex' : 'hidden'} workbench-composer flex-col rounded-lg border border-line bg-white shadow-panel lg:flex lg:min-h-0`}>
          <div className="p-4 pb-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <div className="mb-4">
              <h1 className="text-2xl font-bold leading-tight">上传参考图，描述你想要的结果</h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                上传图片后，选择处理方式并描述你想要的效果。
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
              <UploadedReferenceList
                files={uploaded}
                maxCount={maxReferenceImages}
                onRemove={(id) => setUploaded((items) => items.filter((item) => item.id !== id))}
                onClear={async () => {
                  const ok = await notifications.confirm({
                    title: '清空参考图？',
                    message: '已上传的参考图会从当前编辑中移除。',
                    confirmText: '清空',
                    cancelText: '取消',
                    tone: 'danger'
                  });
                  if (ok) setUploaded([]);
                }}
                onPreview={(images, index) => setLightbox({ title: '参考图预览', images, index })}
              />
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
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="prompt" className="block text-sm font-semibold">
                  编辑指令
                </label>
                <button
                  type="button"
                  className="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-red-200 bg-white px-2 text-xs font-semibold text-red-600 transition-colors hover:border-red-400 hover:bg-red-50"
                  onClick={() => setPrompt('')}
                >
                  清空
                </button>
              </div>
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
              <DropdownSelect
                id="model_channel"
                label="模型通道"
                value={`${provider}:${model}`}
                options={modelChannelOptions}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                onChange={(nextValue) => {
                  const [nextProvider, nextModel] = nextValue.split(':') as [ImageProviderName, string];
                  setProvider(nextProvider);
                  setModel(nextModel);
                }}
                helperText={selectedModelConfig ? selectedModelConfig.description : undefined}
              />

              <DropdownSelect
                id="aspect_ratio"
                label="图片比例"
                value={aspectRatio}
                options={aspectRatioMenuOptions}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                onChange={setAspectRatio}
              />

              <DropdownSelect
                id="quality"
                label="分辨率"
                value={quality}
                options={qualityMenuOptions}
                openMenu={openMenu}
                setOpenMenu={setOpenMenu}
                onChange={(nextValue) => setQuality(nextValue as ImageQuality)}
              />
            </div>

            {(error || referenceLimitError) && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {referenceLimitError ?? error}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-line bg-white p-4 pt-3">
            <button
              disabled={!canSubmit}
              onClick={submit}
              className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 font-bold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {createJobMutation.isPending ? <Loader2 className="animate-spin" size={20} aria-hidden /> : <Wand2 size={20} aria-hidden />}
              开始生成
            </button>
          </div>
        </section>

        <div className="workbench-main min-w-0 lg:min-h-0 lg:overflow-hidden">
          <section className={`${mobileTab === 'detail' ? 'flex' : 'hidden'} workbench-preview min-w-0 flex-col lg:flex lg:h-full lg:min-h-0`}>
            <ResultPanel
              job={previewJob}
              loading={Boolean(jobId && jobQuery.isFetching && !previewJob)}
              isViewingHistory={isViewingHistory}
              onPreview={(title, images, index) => setLightbox({ title, images, index })}
              onEdit={() => {
                if (previewJob) editHistoryJob(previewJob);
              }}
              onReturnLatest={isViewingHistory ? returnToLatest : undefined}
              showReferenceGrid={detailReferenceExpanded}
            />
          </section>

          <section className={`${mobileTab === 'history' ? 'flex' : 'hidden'} workbench-history flex-col lg:flex lg:h-full lg:min-h-0`}>
            <HistoryPanel
              jobs={historyQuery.data ?? []}
              activeJobId={previewJob?.id ?? null}
              onView={viewHistoryJob}
              onEdit={editHistoryJob}
              onDelete={deleteHistoryJob}
              deletingJobId={deleteJobMutation.variables ?? null}
              variant="sidebar"
              onPreview={(images, index) => setLightbox({ title: '历史图片预览', images, index })}
            />
          </section>
        </div>

        {mobileTab === 'account' && (
          <div className="min-h-0 overflow-y-auto lg:hidden">
            <MobileAccountPanel
              active
              isGuest={isGuest}
              logoutPending={logoutMutation.isPending}
              onLogout={() => logoutMutation.mutate()}
            />
          </div>
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          title={lightbox.title}
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((current) => current ? { ...current, index } : current)}
          onClose={() => setLightbox(null)}
        />
      )}

      <MobileBottomNav
        activeTab={mobileTab}
        historyCount={historyQuery.data?.length ?? 0}
        isGuest={isGuest}
        onChange={setMobileTab}
      />
    </main>
  );
}

function ContentPlatformLink({ className = '' }: { className?: string }) {
  return (
    <a
      className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-center text-sm font-semibold leading-5 text-teal-700 transition-colors hover:border-teal-600 hover:bg-teal-100 ${className}`}
      href="https://contentos.ai-mendao.xyz/"
      target="_blank"
      rel="noreferrer"
    >
      <span>
        跳转<span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-purple-600 bg-clip-text font-extrabold text-transparent">小红书/公众号/海报</span>
        <br />
        <span className="text-teal-700">等图文生成</span>
      </span>
    </a>
  );
}

function MobileAccountPanel({
  active,
  isGuest,
  logoutPending,
  onLogout
}: {
  active: boolean;
  isGuest: boolean;
  logoutPending: boolean;
  onLogout: () => void;
}) {
  if (!active) return null;

  return (
    <section className="mx-auto px-3 py-3 sm:px-6 lg:hidden">
      <div className="rounded-lg border border-line bg-white p-4 shadow-panel">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
            <UserCircle size={24} aria-hidden />
          </div>
          <div>
            <h2 className="text-xl font-bold">账户</h2>
            <p className="mt-1 text-sm text-muted">{isGuest ? '登录后可同步历史任务' : '已登录，可管理当前会话'}</p>
          </div>
        </div>
        {isGuest ? (
          <Link
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 font-bold text-white transition-colors hover:bg-teal-700"
            href="/login"
          >
            <UserCircle size={20} aria-hidden />
            登录 / 注册
          </Link>
        ) : (
          <button
            className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 font-bold text-ink transition-colors hover:border-teal-600 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onLogout}
            disabled={logoutPending}
          >
            {logoutPending ? <Loader2 className="animate-spin" size={20} aria-hidden /> : <LogOut size={20} aria-hidden />}
            退出登录
          </button>
        )}
        <ContentPlatformLink className="mt-3 w-full" />
      </div>
    </section>
  );
}

function MobileBottomNav({
  activeTab,
  historyCount,
  isGuest,
  onChange
}: {
  activeTab: MobileTab;
  historyCount: number;
  isGuest: boolean;
  onChange: (tab: MobileTab) => void;
}) {
  const itemClass = (active: boolean) => `flex min-h-[58px] flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-xs font-semibold transition-colors ${
    active ? 'bg-teal-50 text-teal-700' : 'text-muted hover:bg-slate-50 hover:text-ink'
  }`;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-12px_36px_rgba(15,23,42,0.10)] backdrop-blur lg:hidden" aria-label="移动端主导航">
      <div className="mx-auto flex max-w-md gap-1">
        <button type="button" className={itemClass(activeTab === 'create')} onClick={() => onChange('create')}>
          <Wand2 size={21} aria-hidden />
          创作
        </button>
        <button type="button" className={itemClass(activeTab === 'history')} onClick={() => onChange('history')}>
          <span className="relative">
            <History size={21} aria-hidden />
            {historyCount > 0 && (
              <span className="absolute -right-3 -top-2 rounded-full bg-teal-600 px-1.5 text-[10px] leading-4 text-white">
                {historyCount > 99 ? '99+' : historyCount}
              </span>
            )}
          </span>
          历史
        </button>
        {isGuest ? (
          <Link className={itemClass(false)} href="/login">
            <UserCircle size={21} aria-hidden />
            登录
          </Link>
        ) : (
          <button type="button" className={itemClass(activeTab === 'account')} onClick={() => onChange('account')}>
            <UserCircle size={21} aria-hidden />
            我的
          </button>
        )}
      </div>
    </nav>
  );
}

function UploadedReferenceList({
  files,
  maxCount,
  onRemove,
  onClear,
  onPreview
}: {
  files: UploadedFileRecord[];
  maxCount: number;
  onRemove: (id: string) => void;
  onClear: () => void;
  onPreview: (images: PreviewImage[], index: number) => void;
}) {
  const images = filePreviewImages(files);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileImage className="shrink-0 text-teal-700" size={18} aria-hidden />
          <span className="truncate text-sm font-semibold">参考图</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted">{files.length} / {maxCount} 张</span>
          <button
            type="button"
            className="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-red-200 bg-white px-2 text-xs font-semibold text-red-600 transition-colors hover:border-red-400 hover:bg-red-50"
            onClick={onClear}
          >
            清空
          </button>
        </div>
      </div>
      <div className="grid max-h-[360px] grid-cols-3 gap-2 overflow-y-auto bg-slate-50 p-2 sm:grid-cols-4 lg:grid-cols-3">
        {files.map((file, index) => (
          <div key={file.id} className="group relative overflow-hidden rounded-lg border border-line bg-white transition-colors hover:border-teal-500">
            <button
              type="button"
              className="block aspect-square w-full cursor-pointer bg-slate-100 p-1.5"
              onClick={() => onPreview(images, index)}
              aria-label={`打开参考图 ${index + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={file.url} alt={`参考图 ${index + 1} 预览`} className="h-full w-full rounded-md object-contain" />
            </button>
            <button
              type="button"
              className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/80 bg-white/95 text-slate-600 shadow-sm transition-colors hover:border-red-300 hover:text-red-600 focus-visible:border-red-300 focus-visible:text-red-600"
              onClick={() => onRemove(file.id)}
              aria-label={`删除参考图 ${index + 1}`}
              title="删除"
            >
              <Trash2 size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="block w-full cursor-pointer border-t border-line px-2 py-1.5 text-left"
              onClick={() => onPreview(images, index)}
            >
              <span className="block truncate text-xs font-semibold">参考图 {index + 1}</span>
              <span className="block truncate text-[11px] text-muted">
                {file.width && file.height ? `${file.width} x ${file.height}` : `${Math.round(file.size / 1024)} KB`}
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultPanel({
  job,
  loading,
  isViewingHistory,
  onReturnLatest,
  onPreview,
  onEdit,
  showReferenceGrid = false
}: {
  job: ImageJobRecord | null;
  loading: boolean;
  isViewingHistory: boolean;
  onReturnLatest?: () => void;
  onPreview: (title: string, images: PreviewImage[], index: number) => void;
  onEdit?: () => void;
  showReferenceGrid?: boolean;
}) {
  const output = job?.outputImages[0];
  const isWorking = job?.status === 'queued' || job?.status === 'running' || job?.status === 'retrying' || loading;
  const resultImages = (job?.outputImages ?? []).map((image, index) => ({
    url: image.url,
    label: `结果图 ${index + 1}`,
    alt: `结果图 ${index + 1} 预览`,
    meta: image.width && image.height ? `${image.width} x ${image.height}` : undefined
  }));
  const referenceImages = filePreviewImages(job?.inputFiles ?? []);
  const shouldShowReferenceGrid = showReferenceGrid && referenceImages.length > 0;

  return (
    <section className="flex flex-col rounded-lg border border-line bg-white shadow-panel lg:h-full lg:min-h-0">
      <div className="shrink-0 p-3 pb-0 sm:p-4 sm:pb-0">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{isViewingHistory ? '任务详情' : '当前结果'}</h2>
            </div>
            <p className="mt-1 text-sm text-muted">
              {isViewingHistory
                ? '查看结果与参考图，或继续基于这次任务编辑。'
                : '结果会显示在这里，点击图片可查看大图。'}
            </p>
          </div>
          {job && <StatusBadge status={job.status} />}
        </div>

        {isViewingHistory && job && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="line-clamp-2 text-sm font-semibold text-amber-900">{job.prompt}</p>
            <p className="mt-1 text-xs text-amber-700">{new Date(job.createdAt).toLocaleString()} · {formatJobMeta(job)}</p>
          </div>
        )}
      </div>

      <div className="result-scroll-body px-3 pb-3 sm:px-4 sm:pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <div className={`grid gap-3 ${shouldShowReferenceGrid ? 'min-[1024px]:max-[1439px]:grid-cols-[minmax(0,1fr)_240px]' : ''}`}>
        <div className="result-stage-shell overflow-hidden rounded-lg border border-line bg-slate-50">
          <ResultStage
            images={resultImages}
            emptyText={isWorking ? '模型正在处理，请稍候。' : '生成完成后结果会显示在这里。'}
            working={isWorking}
            onOpen={(index) => onPreview('结果图预览', resultImages, index)}
          />
        </div>

        {shouldShowReferenceGrid && (
          <section className="reference-side-panel mt-3 overflow-hidden rounded-lg border border-line bg-white min-[1024px]:max-[1439px]:mt-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm font-semibold">
              <span>参考图</span>
              <span className="text-xs font-medium text-muted">{referenceImages.length} 张</span>
            </div>
            <div className="grid grid-cols-4 gap-2 bg-slate-50 p-2 sm:grid-cols-5 min-[1024px]:max-[1439px]:max-h-[560px] min-[1024px]:max-[1439px]:grid-cols-1 min-[1024px]:max-[1439px]:overflow-y-auto lg:grid-cols-4 xl:grid-cols-6">
              {referenceImages.map((image, index) => (
                <button
                  key={`${image.url}-${index}`}
                  type="button"
                  className="cursor-pointer overflow-hidden rounded-lg border border-line bg-white transition-colors hover:border-teal-600"
                  onClick={() => onPreview('参考图预览', referenceImages, index)}
                  aria-label={`打开${image.label}`}
                >
                  <span className="flex aspect-square items-center justify-center bg-slate-100 p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt={image.alt} className="h-full w-full rounded-md object-contain" />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        </div>

        {job?.status === 'failed' && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {job.error?.message ?? '生成失败，请稍后重试'}
          </div>
        )}

        {output && (
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <a
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 font-semibold text-white transition-colors hover:bg-teal-700"
              href={output.url}
              download
              target="_blank"
            >
              <Download size={18} aria-hidden />
              下载结果
            </a>
            {onEdit && (
              <button
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 font-semibold text-ink transition-colors hover:border-teal-600 hover:text-teal-700"
                onClick={onEdit}
              >
                编辑
              </button>
            )}
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
      </div>
    </section>
  );
}

function ResultStage({
  images,
  emptyText,
  working,
  onOpen
}: {
  images: PreviewImage[];
  emptyText: string;
  working?: boolean;
  onOpen: (index: number) => void;
}) {
  const primary = images[0];

  return (
    <section className="min-w-0 bg-slate-50">
      <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3 text-sm font-semibold">
        <span>生成图</span>
        {images.length > 0 && <span className="text-xs font-medium text-muted">{images.length} 张</span>}
      </div>
      <div className="flex min-h-[240px] items-center justify-center p-3">
        {primary ? (
          <button
            type="button"
            className="group flex h-full w-full cursor-pointer items-center justify-center rounded-lg bg-slate-100 p-3 transition-colors hover:bg-slate-200"
            onClick={() => onOpen(0)}
            aria-label={`打开${primary.label}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={primary.url} alt={primary.alt} className="max-h-[55vh] max-w-full rounded-lg object-contain shadow-sm" />
          </button>
        ) : (
          <div className="max-w-sm text-center text-sm leading-6 text-muted">
            {working && <Loader2 className="mx-auto mb-3 animate-spin text-teal-700" size={28} aria-hidden />}
            {emptyText}
          </div>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-t border-line bg-white p-3">
          {images.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              className="h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-line bg-slate-100 transition-colors hover:border-teal-600"
              onClick={() => onOpen(index)}
              aria-label={`打开${image.label}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.alt} className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </section>
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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const draggedRef = useRef(false);
  const pointerMapRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDistance: number;
    startZoom: number;
    startPan: { x: number; y: number };
  } | null>(null);
  const clampedZoom = Math.min(Math.max(zoom, 1), 4);
  const canPan = clampedZoom > 1.02;

  function showPrevious() {
    if (!hasMultiple) return;
    onIndexChange((index - 1 + images.length) % images.length);
  }

  function showNext() {
    if (!hasMultiple) return;
    onIndexChange((index + 1) % images.length);
  }

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') showPrevious();
      if (event.key === 'ArrowRight') showNext();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasMultiple, images.length, index, onClose, onIndexChange]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [index]);

  useEffect(() => {
    if (!canPan) {
      setPan({ x: 0, y: 0 });
      setIsPanning(false);
    }
  }, [canPan]);

  useEffect(() => {
    function onWindowPointerUp(event: PointerEvent) {
      pointerMapRef.current.delete(event.pointerId);
      if (pointerMapRef.current.size < 2) pinchRef.current = null;
    }

    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
    };
  }, []);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-slate-950/90 text-white"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onClose();
      }}
    >
      <div
        className="relative h-full min-h-0 w-full"
      >
        <button
          type="button"
          className="absolute right-3 top-3 z-20 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/20 bg-slate-950/70 transition-colors hover:bg-white/20 sm:right-5 sm:top-5"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label="关闭预览"
          title="关闭"
        >
          <X size={22} aria-hidden />
        </button>

        <div
          className="flex h-full min-h-0 items-center justify-center overflow-hidden px-2 pb-24 pt-2 sm:px-6 sm:pb-28 sm:pt-6"
          onWheel={(event) => {
            event.stopPropagation();
            setZoom((value) => value + (event.deltaY > 0 ? -0.15 : 0.15));
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            pointerMapRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            event.currentTarget.setPointerCapture(event.pointerId);
            if (pointerMapRef.current.size === 2) {
              const points = Array.from(pointerMapRef.current.values());
              const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
              pinchRef.current = {
                startDistance: distance,
                startZoom: zoom,
                startPan: pan
              };
              setIsPanning(true);
              return;
            }
            if (canPan) setIsPanning(true);
          }}
          onPointerMove={(event) => {
            event.stopPropagation();
            if (!pointerMapRef.current.has(event.pointerId)) return;
            const previousPointer = pointerMapRef.current.get(event.pointerId);
            const currentPointer = { x: event.clientX, y: event.clientY };
            pointerMapRef.current.set(event.pointerId, currentPointer);

            if (pointerMapRef.current.size >= 2) {
              draggedRef.current = true;
              const points = Array.from(pointerMapRef.current.values());
              const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
              const pinch = pinchRef.current;
              if (!pinch) {
                pinchRef.current = {
                  startDistance: distance,
                  startZoom: zoom,
                  startPan: pan
                };
                return;
              }
              const scale = distance / Math.max(pinch.startDistance, 1);
              const nextZoom = Math.min(Math.max(pinch.startZoom * scale, 1), 4);
              setZoom(nextZoom);
              if (nextZoom > 1.02) {
                setPan(pinch.startPan);
              }
              return;
            }

            if (!canPan) return;
            if (!previousPointer) return;
            const dx = currentPointer.x - previousPointer.x;
            const dy = currentPointer.y - previousPointer.y;
            const moved = Math.abs(dx) > 2 || Math.abs(dy) > 2;
            if (moved) draggedRef.current = true;
            setPan((value) => ({ x: value.x + dx, y: value.y + dy }));
            setIsPanning(true);
          }}
          onPointerUp={(event) => {
            if (!pointerMapRef.current.has(event.pointerId)) return;
            event.stopPropagation();
            pointerMapRef.current.delete(event.pointerId);
            if (pointerMapRef.current.size < 2) pinchRef.current = null;
            setIsPanning(false);
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
              // Pointer capture may already be released by the browser.
            }
          }}
          onPointerCancel={() => {
            pointerMapRef.current.clear();
            pinchRef.current = null;
            setIsPanning(false);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.alt}
            className={`max-h-full max-w-full select-none object-contain shadow-2xl ${isPanning ? 'cursor-grabbing' : canPan ? 'cursor-grab' : 'cursor-zoom-in'} ${isPanning ? '' : 'transition-transform duration-150'}`}
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${clampedZoom})`, touchAction: 'none' }}
            draggable={false}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setZoom((value) => value > 1.02 ? 1 : 2);
              setPan({ x: 0, y: 0 });
            }}
          />
        </div>

        {hasMultiple && (
          <div
            className="absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:bottom-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex max-w-full gap-2 overflow-x-auto rounded-lg bg-slate-950/70 p-2 shadow-2xl">
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
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ImageJobRecord['status'] }) {
  const done = status === 'succeeded';
  return (
    <span className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold ${done ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-muted'}`}>
      {done ? <CheckCircle2 size={16} aria-hidden /> : <Loader2 size={16} className={status === 'failed' ? '' : 'animate-spin'} aria-hidden />}
      {statusLabel(status)}
    </span>
  );
}

function HistoryPanel({
  jobs,
  activeJobId,
  onView,
  onEdit,
  onDelete,
  deletingJobId,
  variant,
  onPreview
}: {
  jobs: ImageJobRecord[];
  activeJobId: string | null;
  onView: (job: ImageJobRecord) => void;
  onEdit: (job: ImageJobRecord) => void;
  onDelete: (job: ImageJobRecord) => void;
  deletingJobId: string | null;
  variant: 'sidebar';
  onPreview: (images: PreviewImage[], index: number) => void;
}) {
  return (
    <section
      id="history"
      className={`rounded-lg border border-line bg-white shadow-panel ${
        variant === 'sidebar' ? 'lg:flex lg:h-full lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden' : ''
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-xl font-bold">历史任务</h2>
          <p className="mt-1 text-xs text-muted">查看结果，或继续编辑历史任务</p>
        </div>
        <span className="text-sm text-muted">{jobs.length} 条</span>
      </div>
      {jobs.length === 0 ? (
        <div className="m-4 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
          生成任务会出现在这里。
        </div>
      ) : (
        <div className={`${variant === 'sidebar' ? 'history-scroll-body grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2 min-[1024px]:max-[1439px]:grid-cols-[repeat(auto-fill,minmax(220px,280px))] min-[1024px]:max-[1439px]:justify-start min-[1440px]:grid-cols-1' : ''}`}>
          {jobs.map((job) => (
            <HistoryCard
              key={job.id}
              job={job}
              active={activeJobId === job.id}
              deleting={deletingJobId === job.id}
              onView={() => onView(job)}
              onEdit={() => onEdit(job)}
              onDelete={() => onDelete(job)}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryCard({
  job,
  active,
  deleting,
  onView,
  onEdit,
  onDelete,
  onPreview
}: {
  job: ImageJobRecord;
  active: boolean;
  deleting: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreview: (images: PreviewImage[], index: number) => void;
}) {
  const images = jobLightboxImages(job);
  const thumbnail = job.outputImages[0]?.url ?? job.inputFiles[0]?.url;

  return (
    <article
      className={`min-w-0 rounded-lg border bg-white p-3 transition-colors ${
        active ? 'border-teal-600 ring-2 ring-teal-100' : 'border-line hover:border-teal-600'
      }`}
    >
      <div className="grid gap-3 min-[1440px]:grid-cols-[88px_minmax(0,1fr)]">
        <button
          className="block aspect-[4/3] max-h-44 w-full cursor-pointer overflow-hidden rounded-md bg-slate-100 transition-colors hover:bg-slate-200 min-[1440px]:aspect-[4/5] min-[1440px]:max-h-none"
          onClick={() => {
            if (images.length > 0) onPreview(images, 0);
            else onView();
          }}
          aria-label={`预览历史任务图片：${job.prompt}`}
        >
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail}
              alt="历史任务缩略图"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted">等待</div>
          )}
        </button>

        <div className="min-w-0">
          <button
            className="block w-full cursor-pointer text-left"
            onClick={onView}
            aria-label={`查看历史任务详情：${job.prompt}`}
          >
            <p className="line-clamp-2 text-sm font-semibold leading-5">{job.prompt}</p>
            <p className="mt-1 truncate text-xs text-muted">{formatJobMeta(job)}</p>
          </button>
          <div className="mt-3 grid grid-cols-[1fr_44px_44px] gap-2 min-[1440px]:grid-cols-[1fr_38px_38px]">
            <button
              type="button"
              className="inline-flex h-10 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 text-sm font-bold text-white transition-colors hover:bg-teal-700"
              onClick={onEdit}
            >
              <RefreshCw size={15} aria-hidden />
              <span className="truncate">编辑</span>
            </button>
            <IconActionButton label="查看" onClick={onView}>
              <Eye size={15} aria-hidden />
            </IconActionButton>
            <IconActionButton label="删除" onClick={onDelete} disabled={deleting} tone="danger">
              {deleting ? <Loader2 className="animate-spin" size={15} aria-hidden /> : <Trash2 size={15} aria-hidden />}
            </IconActionButton>
          </div>
        </div>
      </div>
    </article>
  );
}

function IconActionButton({
  label,
  onClick,
  children,
  disabled,
  tone = 'default'
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  const toneClass = {
    default: 'border-line bg-white text-muted hover:border-teal-600 hover:text-teal-700',
    danger: 'border-red-200 bg-white text-red-600 hover:border-red-400 hover:bg-red-50'
  }[tone];

  return (
    <button
      type="button"
      className={`inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
