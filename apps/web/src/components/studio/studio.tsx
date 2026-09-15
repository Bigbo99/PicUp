'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, ArrowLeft, ArrowUp, Box, Check, ChevronDown, History as HistoryIcon, Images, Loader2, Paintbrush, Pencil, Plus, Scan, RectangleVertical, Trash2, UserRound, Wand2 } from 'lucide-react';
import { aspectRatioOptions, resolutionOptions, promptPartsText, type ImageJobCreateRequest, type ImageJobRecord, type PaymentOrderResponse } from '@picup/shared';
import { createImageJob, getImageJob, getMe, getModels, getPaymentOrder, quoteImageJob, referenceJobOutput, updateStudioAsset, uploadImage } from '@/lib/api';
import { useNotifications } from '@/components/notification-provider';
import { Canvas, isWorking } from './canvas';
import { Dialog } from './dialog';
import { Account, CreditActivity, Payment, Recharge } from './account';
import { ImageLightbox, type ImagePreviewMode, type PreviewImage } from './image-lightbox';
import { useStudioDraft, type StudioDraft } from './use-studio-draft';
import { Conversation } from './conversation';
import { AssetLibrary, Conversations } from './library';
import { usePreferences } from './preferences';
import { AuthPanel } from './auth-panel';
import { Board } from './board';
import { studioSkills, type StudioSkill } from './skills';
import { fieldValidationMessage } from '@/lib/user-message';
import { MentionEditor, type MentionEditorHandle } from './mention-editor';

type LocationState = { job: string | null; view: string | null; order: string | null };

export function Studio() {
  const client = useQueryClient();
  const notices = useNotifications();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe, retry: 1 });
  const models = useQuery({ queryKey: ['models'], queryFn: getModels });
  const { draft, update, clear, ready } = useStudioDraft(me.data?.user.id);
  const { preferences, loaded: preferencesLoaded } = usePreferences(me.data?.user.id, true);
  const defaultsApplied = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !preferencesLoaded || !me.data || defaultsApplied.current === me.data.user.id) return;
    defaultsApplied.current = me.data.user.id;
    if (!draft.prompt && !draft.files.length && !draft.parentJobId) update({ quality: preferences.quality, aspectRatio: preferences.aspectRatio, provider: preferences.provider, model: preferences.model });
  }, [ready, preferencesLoaded, me.data, draft.prompt, draft.files.length, draft.parentJobId, preferences.quality, preferences.aspectRatio, preferences.provider, preferences.model, update]);
  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<Partial<typeof preferences>>).detail;
      if (!draft.prompt && !draft.files.length && !draft.parentJobId) update(detail);
    };
    window.addEventListener('picup:preferences-updated', sync); return () => window.removeEventListener('picup:preferences-updated', sync);
  }, [draft.prompt, draft.files.length, draft.parentJobId, update]);
  const [location, setLocation] = useState<LocationState>({ job: null, view: null, order: null });
  const [latestId, setLatestId] = useState<string | null>(null);
  const [freshJobId, setFreshJobId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: PreviewImage[]; index: number; assetKey?: string; mode: ImagePreviewMode } | null>(null);
  const [boardImageUrl, setBoardImageUrl] = useState<string | undefined>();
  const [boardImageFileId, setBoardImageFileId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const [skillsDismissed, setSkillsDismissed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const sizeTrigger = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLElement>(null);
  const prompt = useRef<MentionEditorHandle>(null);
  const uploadBusy = useRef(false);
  const requestKey = useRef<{ signature: string; key: string } | null>(null);
  const [payment, setPayment] = useState<PaymentOrderResponse | null>(null);
  const terminalSeen = useRef<string | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (!shell.current) return;
      const height = window.innerWidth < 1024 ? viewport?.height ?? window.innerHeight : window.innerHeight;
      shell.current.style.setProperty('--studio-height', `${height}px`);
      shell.current.dataset.compact = String(height < 650);
    };
    resize(); viewport?.addEventListener('resize', resize); window.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
  }, []);
  const readLocation = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    setLocation({ job: params.get('job'), view: params.get('view'), order: params.get('order') });
  }, []);
  useEffect(() => {
    readLocation(); window.addEventListener('popstate', readLocation);
    return () => window.removeEventListener('popstate', readLocation);
  }, [readLocation]);
  const navigate = useCallback((patch: Partial<LocationState>, replace = false) => {
    const url = new URL(window.location.href);
    Object.entries(patch).forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
    readLocation();
  }, [readLocation]);
  const closeDialog = useCallback(() => navigate({ view: null, order: null }), [navigate]);
  useEffect(() => {
    if (location.view !== 'board') {
      setBoardImageUrl(undefined);
      setBoardImageFileId(undefined);
    }
  }, [location.view]);
  const selected = useQuery({ queryKey: ['job', location.job], queryFn: () => getImageJob(location.job!), enabled: Boolean(location.job),
    retry: 2, refetchInterval: query => query.state.status === 'error' ? 8000 : !query.state.data || isWorking(query.state.data.status) ? 2000 : false });
  const latest = useQuery({ queryKey: ['job', latestId], queryFn: () => getImageJob(latestId!), enabled: Boolean(latestId && latestId !== location.job),
    refetchInterval: query => isWorking(query.state.data?.status) || !query.state.data ? 3000 : false });
  useEffect(() => {
    if (!me.data?.user.id) return;
    try { setLatestId(sessionStorage.getItem(`picup:latest:${me.data.user.id}`)); } catch { /* Session storage is optional. */ }
  }, [me.data?.user.id]);
  const terminal = selected.data;
  useEffect(() => {
    if (!terminal || isWorking(terminal.status) || terminalSeen.current === `${terminal.id}:${terminal.status}`) return;
    terminalSeen.current = `${terminal.id}:${terminal.status}`;
    void client.invalidateQueries({ queryKey: ['me'] });
    void client.invalidateQueries({ queryKey: ['jobs'] });
    void client.invalidateQueries({ queryKey: ['activity'] });
    void client.invalidateQueries({ queryKey: ['quote'] });
    void client.invalidateQueries({ queryKey: ['assets'] });
    void client.invalidateQueries({ queryKey: ['conversations'] });
  }, [terminal, client]);
  const modelOptions = models.data?.models.filter(model => model.enabled) ?? [];
  const professional = draft.quality === '4K' || draft.files.length >= 4;
  const route = professional ? models.data?.routing?.professional : models.data?.routing?.default;
  const selectedModel = draft.provider === 'auto'
    ? modelOptions.find(model => model.provider === route?.provider && model.model === route.model) ?? modelOptions[0]
    : modelOptions.find(model => model.provider === draft.provider && model.model === draft.model);
  const limit = selectedModel?.maxInputImages ?? 6;
  const ratioOptions = aspectRatioOptions.filter(option => !selectedModel || selectedModel.supportedRatios.includes(option.value));
  const qualityOptions = resolutionOptions.filter(option => !selectedModel || selectedModel.supportedQualities.includes(option.value));
  const patchDraft = useCallback((patch: Partial<StudioDraft>) => {
    update({ ...patch, ...('prompt' in patch && !('promptParts' in patch) ? { promptParts: undefined } : {}), idempotencyKey: undefined }); setError(null);
  }, [update]);
  const skillMatches = !skillsDismissed && /^\/[^\s]*$/.test(draft.prompt) ? studioSkills.filter(skill => skill.label.includes(draft.prompt.slice(1))) : [];
  const applySkill = useCallback((skill: StudioSkill) => {
    const existing = draft.prompt.startsWith('/') ? '' : draft.prompt.trim();
    const next = existing.includes(skill.prompt) ? existing : [skill.prompt, existing].filter(Boolean).join('\n');
    if (next.length > 4000) { setError('输入内容较长，请精简后再添加技能。'); return; }
    const parts = existing && draft.promptParts && !existing.includes(skill.prompt) ? [{ type: 'text' as const, text: `${skill.prompt}\n` }, ...draft.promptParts] : existing === next ? draft.promptParts : undefined;
    patchDraft({ prompt: parts ? promptPartsText(parts) : next, promptParts: parts }); setSkillsDismissed(true);
    if (draft.files.length < skill.minImages) notices.info('已填入创作指令', `请添加至少 ${skill.minImages} 张参考图，再确认生成。`);
    prompt.current?.focus();
  }, [draft.prompt, draft.promptParts, draft.files.length, notices, patchDraft]);
  const applySkillById = useCallback((skillId: string) => {
    const skill = studioSkills.find(item => item.id === skillId);
    if (skill) applySkill(skill);
  }, [applySkill]);
  useEffect(() => {
    if (!ready || !selectedModel) return;
    const patch: Partial<StudioDraft> = {};
    if (!selectedModel.supportedRatios.includes(draft.aspectRatio)) patch.aspectRatio = selectedModel.supportedRatios[0] ?? 'auto';
    if (!selectedModel.supportedQualities.includes(draft.quality)) patch.quality = selectedModel.supportedQualities[0] ?? '1K';
    if (Object.keys(patch).length) patchDraft(patch);
  }, [selectedModel, draft.aspectRatio, draft.quality, ready, patchDraft]);
  // Keep new submissions in the visible conversation until the user clicks "新对话".
  // Failed jobs cannot be parents, so fall back to their existing valid parent.
  const conversationParentJobId = selected.data
    ? selected.data.status === 'succeeded' ? selected.data.id : selected.data.parentJobId
    : location.job ?? undefined;
  const activeParentJobId = draft.parentJobId === selected.data?.id && selected.data?.status !== 'succeeded'
    ? conversationParentJobId
    : draft.parentJobId ?? conversationParentJobId;
  const request = useMemo<ImageJobCreateRequest>(() => ({
    mode: draft.files.length ? 'edit' : 'generate', provider: selectedModel?.provider ?? draft.provider, model: selectedModel?.model ?? draft.model, template: 'auto', prompt: draft.prompt,
    promptParts: draft.promptParts, imageIds: draft.files.map(file => file.id), aspectRatio: draft.aspectRatio, quality: draft.quality, parentJobId: activeParentJobId, paymentMode: 'credits'
  }), [draft.files, draft.provider, draft.model, draft.prompt, draft.promptParts, draft.aspectRatio, draft.quality, activeParentJobId, selectedModel?.provider, selectedModel?.model]);
  const quotedRequest = useMemo(() => ({ ...request, prompt: '积分预估', promptParts: undefined, parentJobId: undefined }), [request]);
  const guest = !me.data || me.data.user.isGuest;
  const quote = useQuery({ queryKey: ['quote', me.data?.user.id, quotedRequest], queryFn: () => quoteImageJob(quotedRequest),
    enabled: ready && !guest && Boolean(selectedModel) && models.data?.source !== 'fallback', retry: 1 });
  const upload = useMutation({ mutationFn: async (files: File[]) => {
    const results = await Promise.allSettled(files.map(file => uploadImage(file)));
    return { uploaded: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
      errors: results.flatMap(result => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : '上传失败'] : []) };
  }, onSuccess: result => {
    const files = [...new Map([...draft.files, ...result.uploaded].map(file => [file.id, file])).values()];
    patchDraft({ files }); if (result.errors.length) setError(result.errors.join('；'));
  }, onError: error => setError(error.message), onSettled: () => { uploadBusy.current = false; } });
  function handleFiles(files: File[]) {
    if (uploadBusy.current || !files.length) return;
    const available = limit - draft.files.length;
    if (available <= 0) { setError(`当前模型最多支持 ${limit} 张参考图`); return; }
    const accepted = files.filter(file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 10 * 1024 * 1024).slice(0, available);
    if (accepted.length !== files.length) notices.warning('部分图片未添加', `仅支持 10MB 以内的 JPG、PNG、WEBP，最多 ${limit} 张`);
    if (!accepted.length) return;
    uploadBusy.current = true; upload.mutate(accepted);
  }
  const create = useMutation({ mutationFn: createImageJob, onSuccess: (response, variables) => {
    if (response.paymentRequired && response.paymentOrder) {
      update({ pendingPayment: { orderId: response.paymentOrder.id, input: variables } });
      setPayment(response.paymentOrder); navigate({ view: 'payment', order: response.paymentOrder.id }); return;
    }
    if (!response.jobId) { setError('任务未创建，请稍后重试'); return; }
    setLatestId(response.jobId);
    setFreshJobId(response.jobId);
    if (me.data) { try { sessionStorage.setItem(`picup:latest:${me.data.user.id}`, response.jobId); } catch { /* Optional persistence. */ } }
    navigate({ job: response.jobId, view: null }); update({ prompt: '', promptParts: undefined, parentJobId: response.jobId, idempotencyKey: undefined, awaitingJobId: response.jobId, pendingPayment: undefined }); requestKey.current = null;
    void client.invalidateQueries({ queryKey: ['jobs'] }); void client.invalidateQueries({ queryKey: ['me'] }); void client.invalidateQueries({ queryKey: ['quote'] }); setError(null);
  }, onError: error => setError(error.message) });
  const continueJob = useMutation({ mutationFn: ({ job, index }: { job: ImageJobRecord; index: number; automatic?: boolean }) => referenceJobOutput(job.id, index),
    onSuccess: (file, { job, automatic }) => {
      patchDraft({ files: [file], prompt: automatic ? draft.prompt : '', parentJobId: job.id, provider: job.provider, model: job.model, aspectRatio: job.aspectRatio, quality: job.quality });
      if (!automatic) { navigate({ job: job.id, view: null }); prompt.current?.focus(); }
    }, onError: error => setError(error.message) });
  useEffect(() => {
    if (!preferencesLoaded || !ready || !selected.data || draft.awaitingJobId !== selected.data.id || isWorking(selected.data.status)) return;
    update({ awaitingJobId: undefined, ...(draft.parentJobId === selected.data.id && selected.data.status !== 'succeeded'
      ? { parentJobId: selected.data.parentJobId } : {}) });
  }, [selected.data, draft.awaitingJobId, draft.parentJobId, update, preferencesLoaded, ready]);
  const currentWorking = isWorking((latestId === location.job ? selected.data : latest.data)?.status);
  useEffect(() => { if (selected.data?.id === freshJobId) setFreshJobId(null); }, [selected.data?.id, freshJobId]);
  const quoteCurrent = !quote.isPending && !quote.isError;
  const busy = create.isPending || upload.isPending || continueJob.isPending || currentWorking;
  const canSubmit = ready && !busy && draft.prompt.trim().length > 0 && draft.files.length <= limit && !guest
    && draft.prompt.length <= 4000 && (!draft.promptParts || (draft.promptParts.length <= 200 && draft.promptParts.every(part => part.type === 'text' || draft.files.some(file => file.id === part.fileId))))
    && Boolean(selectedModel) && models.data?.source !== 'fallback' && quoteCurrent && Boolean(quote.data?.available) && !quote.isFetching;
  function submit() {
    if (!canSubmit) return;
    const signature = JSON.stringify(request);
    if (requestKey.current?.signature !== signature) {
      const cryptoApi = globalThis.crypto;
      const key = draft.idempotencyKey ?? cryptoApi?.randomUUID?.() ?? (() => {
        const bytes = cryptoApi?.getRandomValues?.(new Uint8Array(16));
        return bytes ? Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      })();
      requestKey.current = { signature, key };
    }
    update({ idempotencyKey: requestKey.current.key }); create.mutate({ ...request, idempotencyKey: requestKey.current.key });
  }
  function reuseParameters(job: ImageJobRecord) {
    patchDraft({ prompt: job.prompt, promptParts: job.promptParts, files: job.inputFiles, provider: job.provider, model: job.model,
      aspectRatio: job.aspectRatio, quality: job.quality, parentJobId: job.parentJobId }); prompt.current?.focus();
  }
  async function newWork() {
    if ((draft.prompt.trim() || draft.files.length) && !await notices.confirm({ title: '开始新对话？', message: '当前草稿将被清空，已生成的图片仍保留在历史中。', confirmText: '新对话' })) return;
    clear(); update({ quality: preferences.quality, aspectRatio: preferences.aspectRatio, provider: preferences.provider, model: preferences.model }); navigate({ job: null, view: null }); requestKey.current = null; setError(null);
  }
  const openPayment = useCallback((order: PaymentOrderResponse) => { setPayment(order); navigate({ view: 'payment', order: order.id }); }, [navigate]);
  const restoredPayment = useQuery({ queryKey: ['payment-order', location.order], queryFn: () => getPaymentOrder(location.order!), enabled: Boolean(location.order && location.order !== payment?.id) });
  const paid = useCallback(() => {
    const pending = draft.pendingPayment;
    setPayment(null);
    if (pending && pending.orderId === location.order) {
      navigate({ view: null, order: null }, true);
      create.mutate({ ...pending.input, paymentMode: 'single', paymentOrderId: pending.orderId });
    } else navigate({ view: 'recharge', order: null }, true);
    void client.invalidateQueries({ queryKey: ['me'] }); void client.invalidateQueries({ queryKey: ['activity'] }); void client.invalidateQueries({ queryKey: ['quote'] });
  }, [client, navigate, draft.pendingPayment, location.order, create]);
  const paymentOrder = payment?.id === location.order ? payment : restoredPayment.data;
  const quoteLabel = models.data?.source === 'fallback' ? '模型暂不可用' : quote.isError ? '积分查询失败' : `${quote.data?.credits ?? selectedModel?.costCredits ?? 0} 积分`;

  return <main ref={shell} className="studio-app chat-app" data-empty={!location.job} onInvalid={event => {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) field.setCustomValidity(fieldValidationMessage(field));
  }} onInput={event => {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) field.setCustomValidity('');
  }} onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault(); handleFiles(Array.from(event.dataTransfer.files));
  }} onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); handleFiles(files); } }}>
    <header className="studio-header"><Link href="/" className="studio-brand" aria-label="PicUp 工作台"><img className="studio-wordmark" src="/brand/picup-wordmark.png" alt="PicUp 片刻 P 图" width={108} height={54} /></Link>
      <div className="header-spacer" />
      {(location.job || draft.files.length > 0) && <button className="studio-icon" onClick={newWork} title="新对话" aria-label="新对话"><Plus size={20} /></button>}
      {latestId && latestId !== location.job && <button className="studio-secondary return-latest" aria-label="当前任务" title="返回当前任务" onClick={() => navigate({ job: latestId, view: null })}><ArrowLeft size={16} /><span>当前任务</span></button>}
      {me.data && !guest && <button className="balance-button" title="查看积分与交易" aria-label="查看积分与交易" onClick={() => navigate({ view: 'credits' })}>{me.data.credits.balance} <span>积分</span></button>}
      <button className="studio-icon" title="对话历史" aria-label="对话历史" onClick={() => navigate({ view: 'conversations' })}><HistoryIcon size={20} /></button>
    </header>
    <div className="studio-workspace">
      <nav className="studio-navigation" aria-label="主导航">
        <button onClick={() => navigate({ view: null })} aria-current={!location.view ? 'page' : undefined}><Wand2 size={20} /><span>创作</span></button>
        <button onClick={() => navigate({ view: 'history' })} aria-current={location.view === 'history' ? 'page' : undefined}><Images size={20} /><span>图库</span></button>
        <button className="navigation-account" title={guest ? '登录 / 注册' : '账户与设置'} aria-label={guest ? '登录 / 注册' : '账户与设置'} onClick={() => navigate({ view: guest ? 'login' : 'account' })}><span className="navigation-avatar"><UserRound size={20} /><i data-signed-in={!guest} /></span><span className="navigation-identity"><strong>{guest ? '登录 / 注册' : me.data?.user.displayName || me.data?.user.email || '已登录'}</strong><small>{guest ? '未登录' : '已登录'}</small></span></button>
      </nav>
      <Conversation job={selected.data} loading={Boolean(location.job && selected.isPending)} error={selected.error?.message} onUpload={() => input.current?.click()} onOpen={(images, index) => setLightbox({ images, index, mode: 'conversation' })} onSkillSelect={applySkillById}>
      {(conversationImages) => <Canvas job={selected.data} editingJobId={draft.parentJobId} files={draft.files} loading={Boolean(location.job && selected.isPending && freshJobId !== location.job)} error={selected.error?.message}
        onUpload={() => input.current?.click()} onPreview={(images, index) => {
          const image = images[index];
          const globalIndex = image?.meta ? conversationImages.findIndex(item => item.meta === image.meta) : -1;
          setLightbox({ images: conversationImages.length ? conversationImages : images, index: globalIndex >= 0 ? globalIndex : index, mode: 'conversation' });
        }}
        onContinue={index => selected.data && continueJob.mutate({ job: selected.data, index })} continuing={continueJob.isPending}
        onRetry={() => selected.data && reuseParameters(selected.data)} />}
      </Conversation>
      <aside className="studio-composer" aria-label="创作指令">
        <div className="composer-input integrated-composer">
          <div className="composer-writing">
          <div className="composer-reference-stack" data-filled={draft.files.length > 0}>
            {draft.files.length > 0 && <button className="reference-stack-preview" title="管理参考图" aria-label={`管理参考图，共 ${draft.files.length} 张`} aria-haspopup="dialog" onClick={() => navigate({ view: 'references' })}>
              {draft.files.slice(0, 3).map((file, index) => <img key={file.id} src={file.url} alt="" style={{ transform: `translate(${index * 4}px, ${index * -3}px) rotate(${(index - 1) * 8}deg)`, zIndex: index }} />)}
              <span className="reference-stack-count">{draft.files.length}</span>
            </button>}
            <button className="composer-add-image" title={draft.files.length >= limit ? `最多添加 ${limit} 张参考图` : '添加参考图'} aria-label="添加参考图" disabled={upload.isPending || draft.files.length >= limit} onClick={() => input.current?.click()}>{upload.isPending ? <Loader2 size={20} className="animate-spin" /> : <Plus size={22} strokeWidth={1.5} />}</button>
          </div>
          <div className="composer-writing-content">
          <label className="prompt-label" htmlFor="studio-prompt">{activeParentJobId ? '继续修改这张图' : '你想创作什么？'}</label>
          <MentionEditor ref={prompt} userId={me.data?.user.id} disabled={!ready || create.isPending} prompt={draft.prompt} parts={draft.promptParts} files={draft.files} placeholder={draft.files.length ? '把背景换成白色，保留主体不变…' : '描述画面、风格和细节…'}
            onPreview={(fileId, label) => {
              const index = draft.files.findIndex(file => file.id === fileId);
              if (index < 0) { setError('引用图片已不可用，请重新添加'); return; }
              setLightbox({ images: draft.files.map((file, i) => ({ url: file.url, label: file.id === fileId ? label : `参考图 ${i + 1}`, alt: `参考图 ${i + 1}` })), index, mode: 'references' });
            }}
            onBlur={() => setSkillsDismissed(true)} canAdd={file => { if (!draft.files.some(item => item.id === file.id) && draft.files.length >= limit) { setError(`当前模型最多支持 ${limit} 张参考图`); return false; } return true; }}
            onChange={(text, parts, file) => { patchDraft({ prompt: text, promptParts: parts.some(part => part.type === 'image') ? parts : undefined, ...(file && !draft.files.some(item => item.id === file.id) ? { files: [...draft.files, file] } : {}) }); setSkillIndex(0); setSkillsDismissed(false); }} onKeyDown={event => {
              if (!event.isComposing && skillMatches.length) {
                if (event.key === 'Escape') { event.preventDefault(); setSkillsDismissed(true); return; }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSkillIndex(index => (index + (event.key === 'ArrowDown' ? 1 : skillMatches.length - 1)) % skillMatches.length); return; }
                if (event.key === 'Enter') { event.preventDefault(); applySkill(skillMatches[skillIndex] ?? skillMatches[0]); return; }
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches) { event.preventDefault(); submit(); }
            }} />
          </div></div>
          {skillMatches.length > 0 && <div className="skill-options" id="skill-options" role="listbox" aria-label="创作技能">{skillMatches.map((skill, index) => <button key={skill.id} id={`skill-${skill.id}`} role="option" aria-selected={index === skillIndex} tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => applySkill(skill)}><Wand2 size={18} aria-hidden="true" /><span className="skill-option-copy"><strong>/ {skill.label}</strong><small>{skill.description}</small></span><span className="skill-option-meta">{skill.minImages} 张参考图起</span></button>)}</div>}
          {(error || draft.files.length > limit) && <p role="alert" className="studio-error">{error || `最多支持 ${limit} 张参考图`}</p>}
          {draft.prompt.length > 4000 && <p role="alert" className="studio-error">描述不能超过 4000 字，请精简后发送。</p>}
          {draft.promptParts?.some(part => part.type === 'image' && !draft.files.some(file => file.id === part.fileId)) && <p role="alert" className="studio-error">引用图片不在参考图区，请删除该引用并重新选择。</p>}
          {me.isError && <button className="studio-text-button" onClick={() => me.refetch()}>账户连接失败，点击重试</button>}
          {draft.pendingPayment && <button className="studio-text-button" onClick={() => navigate({ view: 'payment', order: draft.pendingPayment!.orderId })}>继续支付中的任务</button>}
          <div className="composer-bottom-row"><div className="composer-selectors"><button className="composer-selector" aria-label="打开画板" title="画板" onClick={() => { setBoardImageUrl(undefined); setBoardImageFileId(undefined); navigate({ view: 'board' }); }}><Paintbrush size={18} /><span>画板</span></button>
            <button className="composer-selector composer-mention-trigger" aria-label="引用图片或主体" title="引用图片或主体" aria-haspopup="listbox" disabled={!ready || create.isPending} onPointerDown={event => event.preventDefault()} onClick={event => prompt.current?.openMentions(event.currentTarget)}><AtSign size={19} /></button>
            <button ref={modelTrigger} className="composer-selector model-selector" aria-label="选择模型" aria-haspopup="dialog" aria-expanded={location.view === 'models'} onClick={() => navigate({ view: 'models' })}><Box size={18} /><span>{draft.provider === 'auto' ? '自动推荐' : selectedModel?.displayName || '选择模型'}</span><ChevronDown size={14} /></button>
            <button ref={sizeTrigger} className="composer-selector" aria-label="比例与清晰度" aria-haspopup="dialog" aria-expanded={location.view === 'settings'} onClick={() => navigate({ view: 'settings' })}><RectangleVertical size={17} /><span>{draft.aspectRatio === 'auto' ? '智能' : draft.aspectRatio} · {draft.quality}</span><ChevronDown size={14} /></button>
          </div><div className="composer-submit"><span className="quote-label" aria-live="polite">{quoteLabel}</span>
            {guest ? <button className="studio-primary" onClick={() => navigate({ view: 'login' })}>登录后生成</button> : <button className="studio-primary chat-send" title="发送并生成图片" aria-label={create.isPending ? '提交中' : currentWorking ? '生成中' : '生成'} onClick={submit} disabled={!canSubmit}>
              {busy ? <Loader2 className="animate-spin" size={18} /> : <ArrowUp size={21} />}
            </button>}
          </div></div>
        </div>
      </aside>
    </div>
    <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={event => { handleFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    {location.view === 'references' && <Dialog title="参考图片" onClose={closeDialog}><div className="reference-manager">
      {error && <p className="studio-error" role="alert">{error}</p>}
      <div className="reference-tray">{draft.files.map((file, index) => <div key={file.id} className={index >= limit ? 'reference-over-limit' : undefined}>
        <button className="reference-preview" aria-label={`预览参考图 ${index + 1}${index >= limit ? '，超出当前模型上限' : ''}`} onClick={() => setLightbox({ images: draft.files.map((item, i) => ({ url: item.url, label: `参考图 ${i + 1}`, alt: `参考图 ${i + 1}` })), index, mode: 'references' })}><img src={file.url} alt={`参考图 ${index + 1}`} /></button>
        <button className="reference-edit" aria-label={`继续绘制参考图 ${index + 1}`} title="继续绘制" onClick={() => { setBoardImageUrl(file.url); setBoardImageFileId(file.id); closeDialog(); navigate({ view: 'board' }); }}><Pencil size={16} /></button>
        <button className="reference-remove" aria-label={`移除参考图 ${index + 1}`} title="移除参考图" onClick={() => { const parts = draft.promptParts?.filter(part => part.type === 'text' || part.fileId !== file.id); patchDraft({ files: draft.files.filter(item => item.id !== file.id), parentJobId: undefined, ...(parts ? { prompt: promptPartsText(parts), promptParts: parts } : {}) }); }}><Trash2 size={16} /></button>
      </div>)}</div>
      {!draft.files.length && <p className="studio-empty">还没有参考图片</p>}
      <div className="reference-manager-actions"><button className="studio-secondary" disabled={upload.isPending || draft.files.length >= limit} onClick={() => input.current?.click()}><Plus size={17} />添加参考图</button></div>
      <span className="reference-limit">{draft.files.length} / {limit} 张</span>
    </div></Dialog>}
    {location.view === 'board' && <Dialog title="画板" hideHeading onClose={closeDialog}><Board initialImageUrl={boardImageUrl} onClose={closeDialog} onSave={async file => {
      let replacement;
      try {
        replacement = await uploadImage(file);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : '画板图片上传失败');
        return;
      }
      if (boardImageFileId) {
        patchDraft({ files: draft.files.map(item => item.id === boardImageFileId ? replacement : item), promptParts: draft.promptParts?.map(part => part.type === 'image' && part.fileId === boardImageFileId ? { type: 'image', fileId: replacement.id, label: part.label } : part) });
        await updateStudioAsset(`file:${boardImageFileId}`, { hidden: true });
      } else {
        patchDraft({ files: [...draft.files, replacement] });
      }
      setBoardImageUrl(undefined); setBoardImageFileId(undefined); closeDialog();
      void client.invalidateQueries({ queryKey: ['assets'] });
    }} /></Dialog>}
    {location.view === 'models' && <Dialog title="选择模型" anchor={modelTrigger.current} onClose={closeDialog}><div className="composer-model-list">
      <button className="composer-model-option" aria-pressed={draft.provider === 'auto'} onClick={() => { patchDraft({ provider: 'auto', model: 'auto' }); closeDialog(); }}><span className="model-symbol"><Wand2 size={22} /></span><span><strong>自动推荐</strong><small>{selectedModel?.displayName || '自动选择可用模型'}</small></span>{draft.provider === 'auto' && <Check size={19} />}</button>
      {modelOptions.map(model => <button className="composer-model-option" key={`${model.provider}:${model.model}`} aria-pressed={draft.provider === model.provider && draft.model === model.model} onClick={() => { patchDraft({ provider: model.provider, model: model.model }); closeDialog(); }}><span className="model-symbol"><Box size={22} /></span><span><strong>{model.displayName}</strong><small>{model.description}</small></span>{draft.provider === model.provider && draft.model === model.model && <Check size={19} />}</button>)}
    </div></Dialog>}
    {location.view === 'settings' && <Dialog title="生成设置" anchor={sizeTrigger.current} onClose={closeDialog}><div className="composer-size-options">
      <fieldset><legend>图片比例</legend><div className="ratio-options">{ratioOptions.map(option => <button key={option.value} aria-pressed={draft.aspectRatio === option.value} onClick={() => patchDraft({ aspectRatio: option.value })}>{option.value === 'auto' ? <Scan size={20} /> : <span className="ratio-symbol" style={{ aspectRatio: option.value.replace(':', '/'), width: option.value.split(':').map(Number)[0] >= option.value.split(':').map(Number)[1] ? 23 : undefined, height: option.value.split(':').map(Number)[0] < option.value.split(':').map(Number)[1] ? 23 : undefined }} />}<span>{option.value === 'auto' ? '智能' : option.value}</span></button>)}</div></fieldset>
      <fieldset><legend>清晰度</legend><div className="quality-options">{qualityOptions.map(option => <button key={option.value} aria-pressed={draft.quality === option.value} onClick={() => patchDraft({ quality: option.value as StudioDraft['quality'] })}>{option.label}</button>)}</div></fieldset>
      <div className="size-options-footer"><span className="quote-label">{quoteLabel}</span><button className="studio-primary" onClick={closeDialog}>完成</button></div>
    </div></Dialog>}
    {location.view === 'conversations' && <Dialog title="对话历史" drawer onClose={closeDialog}><Conversations onDeleted={rootJobId => { if (location.job === rootJobId) navigate({ job: null, view: null }); }} onOpen={async id => {
      if (draft.prompt.trim() && !await notices.confirm({ title: '切换对话？', message: '当前未发送的草稿将被替换。', confirmText: '切换' })) return;
      try {
        const job = await getImageJob(id);
        client.setQueryData(['job', id], job);
        patchDraft({ prompt: '', files: [], parentJobId: undefined }); navigate({ job: id, view: null });
      } catch (error) { notices.error('打开对话失败', error instanceof Error ? error.message : '请重试'); }
    }} /></Dialog>}
    {location.view === 'history' && <Dialog title="图库" drawer onClose={closeDialog}><AssetLibrary onPreview={(asset, collection) => {
      const images = collection.map(item => ({
        url: item.url,
        label: item.title,
        alt: item.title,
        meta: item.key,
        downloadUrl: item.jobId ? `/api/image/jobs/${item.jobId}/download/${item.index}` : item.url
      }));
      const index = Math.max(0, images.findIndex(image => image.meta === asset.key));
      setLightbox({ assetKey: asset.key, images, index, mode: 'gallery' });
    }} onSubject={subject => { closeDialog(); prompt.current?.insertSubject(subject); }} onUse={async asset => {
      if (asset.jobId) {
        const file = await referenceJobOutput(asset.jobId, asset.index);
        patchDraft({ files: [file], parentJobId: asset.jobId });
        navigate({ job: asset.jobId, view: null });
      } else if (asset.fileId) {
        patchDraft({ files: [{ id: asset.fileId, url: asset.url, mimeType: '', size: 0, createdAt: asset.createdAt }], parentJobId: activeParentJobId });
        // Close the drawer while preserving the currently open conversation.
        navigate({ view: null });
      }
      prompt.current?.focus();
    }} /></Dialog>}
    {location.view === 'login' && <Dialog title="登录 PicUp" onClose={closeDialog}><AuthPanel onSuccess={async () => {
      const account = await getMe();
      if (account.user.isGuest) throw new Error('登录状态尚未更新，请重试');
      try { sessionStorage.setItem(`picup:studio:${account.user.id}`, JSON.stringify(draft)); } catch { /* Storage can be unavailable in private browsing. */ }
      client.setQueryData(['me'], account);
      await client.invalidateQueries({ queryKey: ['studio-preferences'] });
      closeDialog();
    }} /></Dialog>}
    {location.view === 'recharge' && <Dialog title="积分充值" onClose={closeDialog}><Recharge me={me.data} onPayment={openPayment} /></Dialog>}
    {location.view === 'credits' && <Dialog title="积分与交易" onClose={closeDialog}><CreditActivity me={me.data} onRecharge={() => navigate({ view: 'recharge' })} onPayment={openPayment} /></Dialog>}
    {location.view === 'account' && <Dialog title="账户与设置" drawer onClose={closeDialog}><Account me={me.data} models={models.data} onRecharge={() => navigate({ view: 'recharge' })} onPayment={openPayment} onLogin={() => navigate({ view: 'login' })} onLogout={() => {
      clear(); if (me.data) sessionStorage.removeItem(`picup:latest:${me.data.user.id}`); setLatestId(null); setPayment(null);
      navigate({ job: null, view: null, order: null }); client.clear(); void me.refetch();
    }} /></Dialog>}
    {location.view === 'payment' && <Dialog title="微信支付" onClose={closeDialog}>{paymentOrder && ready ? <Payment key={paymentOrder.id} order={paymentOrder} onPaid={paid} /> : <div className="studio-empty">{restoredPayment.isError ? '订单加载失败' : '正在恢复订单'}{restoredPayment.isError && <button className="studio-secondary" onClick={() => restoredPayment.refetch()}>重试</button>}</div>}</Dialog>}
    {lightbox && <Dialog title="图片预览" fullscreen onClose={() => setLightbox(null)}><ImageLightbox mode={lightbox.mode} title="图片预览" images={lightbox.images} index={lightbox.index} onIndexChange={index => setLightbox(previous => previous ? { ...previous, index, ...(previous.assetKey ? { assetKey: previous.images[index]?.meta } : {}) } : previous)} onEdit={image => { setBoardImageUrl(image.url); setBoardImageFileId(lightbox.assetKey?.startsWith('file:') ? lightbox.assetKey.slice(5) : undefined); setLightbox(null); navigate({ view: 'board' }); }} onDelete={lightbox.mode === 'gallery' && lightbox.assetKey ? async () => {
      if (!await notices.confirm({ title: '删除这张图片？', message: '删除后将从图库中隐藏，对话中的图片仍会保留。', confirmText: '删除', tone: 'danger' })) return;
      await updateStudioAsset(lightbox.assetKey!, { hidden: true });
      setLightbox(null);
      void client.invalidateQueries({ queryKey: ['assets'] });
    } : undefined} onClose={() => setLightbox(null)} /></Dialog>}
  </main>;
}
