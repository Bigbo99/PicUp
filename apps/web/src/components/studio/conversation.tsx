'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, Pencil, Wand2, X, ArrowUp } from 'lucide-react';
import type { ImageJobRecord } from '@picup/shared';
import { getImageJob } from '@/lib/api';
import { JobStatus } from './canvas';
import type { PreviewImage } from './image-lightbox';
import { userMessage } from '@/lib/user-message';
import { studioSkills } from './skills';
import { MessagePrompt } from './message-prompt';
import { ImageParameters } from './image-parameters';
import { MessageAttachments } from './message-attachments';

export function Conversation({ job, loading, error, children, onUpload: _onUpload, onOpen, onSkillSelect, onEditSubmit, onContinue, continuing }: {
  job?: ImageJobRecord; loading?: boolean; error?: string; children: React.ReactNode | ((images: PreviewImage[]) => React.ReactNode); onUpload: () => void; onOpen: (images: PreviewImage[], index: number) => void; onSkillSelect: (skillId: string) => void; onEditSubmit: (job: ImageJobRecord, prompt: string) => Promise<void>; onContinue: (job: ImageJobRecord, index: number) => void; continuing: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useRef<string | null>(null);
  const editAnchor = useRef<{ id: string; top: number; width: number; height: number } | null>(null);
  function changeEditing(id: string | null) {
    const targetId = id ?? editing.current;
    const message = Array.from(scroll.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []).find(element => element.dataset.messageId === targetId);
    if (message && scroll.current) {
      const bounds = message.getBoundingClientRect();
      editAnchor.current = { id: targetId!, top: Math.max(scroll.current.getBoundingClientRect().top + 12, bounds.top), width: bounds.width, height: bounds.height };
    }
    editing.current = id;
    pinned.current = false;
    setEditingId(id);
  }
  useLayoutEffect(() => {
    const anchor = editAnchor.current;
    const container = scroll.current;
    if (!anchor || !container) return;
    editAnchor.current = null;
    const message = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]')).find(element => element.dataset.messageId === anchor.id);
    if (!message) return;
    const bounds = message.getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    const targetTop = Math.max(viewport.top + 12, Math.min(anchor.top, viewport.bottom - Math.min(bounds.height, container.clientHeight - 24) - 12));
    container.scrollTop += bounds.top - targetTop;
    if (editingId && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const animation = message.animate([
        { width: `${anchor.width}px`, height: `${anchor.height}px`, overflow: 'hidden' },
        { width: `${bounds.width}px`, height: `${bounds.height}px`, overflow: 'hidden' }
      ], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
      return () => animation.cancel();
    }
    if (!editingId) message.querySelector<HTMLButtonElement>('.message-prompt-edit')?.focus({ preventScroll: true });
  }, [editingId]);
  const parents = useQuery({ queryKey: ['conversation-parents', job?.id], enabled: Boolean(job?.parentJobId), queryFn: async () => {
    const messages: ImageJobRecord[] = [];
    const seen = new Set<string>([job!.id]);
    let id = job!.parentJobId;
    while (id && !seen.has(id) && messages.length < 50) {
      seen.add(id);
      const parent = await getImageJob(id);
      messages.unshift(parent); id = parent.parentJobId;
    }
    return messages;
  } });
  useEffect(() => { if (!editing.current) end.current?.scrollIntoView({ block: 'end' }); }, [job?.id, job?.status, parents.data]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (scroll.current) scroll.current.style.setProperty('--inline-editor-max-height', `${Math.max(140, scroll.current.clientHeight - 24)}px`);
      if (!editing.current && pinned.current) end.current?.scrollIntoView({ block: 'end' });
    });
    if (scroll.current) observer.observe(scroll.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!editing.current) { if (pinned.current) end.current?.scrollIntoView({ block: 'end' }); return; }
        const container = scroll.current;
        const editor = container?.querySelector<HTMLElement>('.chat-inline-editor');
        if (!container || !editor) return;
        const bounds = editor.getBoundingClientRect();
        const viewport = container.getBoundingClientRect();
        if (bounds.top < viewport.top + 12) container.scrollTop += bounds.top - viewport.top - 12;
        else if (bounds.bottom > viewport.bottom - 12) container.scrollTop += Math.min(bounds.bottom - viewport.bottom + 12, bounds.top - viewport.top - 12);
      });
    };
    window.addEventListener('resize', resize);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); viewport?.removeEventListener('resize', resize); };
  }, []);
  const conversationJobs = [...(parents.data ?? []), ...(job ? [job] : [])];
  const conversationImages = conversationJobs.flatMap(message => [
    ...message.inputFiles.map((file, index) => ({
      url: file.url,
      label: `参考图 ${index + 1}`,
      alt: `${message.prompt || '本轮任务'}的参考图 ${index + 1}`,
      meta: `${message.id}:input:${file.id}`
    })),
    ...message.outputImages.map((output, index) => ({
      url: output.url,
      label: `结果 ${index + 1}`,
      alt: message.prompt || `结果 ${index + 1}`,
      meta: `${message.id}:output:${index}`,
      downloadUrl: `/api/image/jobs/${message.id}/download/${index}`
    }))
  ]);
  const content = typeof children === 'function' ? children(conversationImages) : children;
  return <section ref={scroll} className="chat-conversation" data-editing={Boolean(editingId)} aria-label="创作对话" onScroll={event => {
    const element = event.currentTarget;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setAway(!pinned.current);
  }}>
    <div className="chat-thread">
      {parents.isError && <button className="studio-text-button" onClick={() => parents.refetch()}>加载前面的对话失败，重试</button>}
      {parents.data?.map(message => <article className="chat-turn" key={message.id}>
        <div className="chat-user-message" data-message-id={message.id} data-role="user" data-reference={Boolean(message.parentJobId)}>
          <MessageAttachments job={message} parent={conversationJobs.find(item => item.id === message.parentJobId)} onPreview={fileId => {
            const meta = `${message.id}:input:${fileId}`;
            const globalIndex = conversationImages.findIndex(image => image.meta === meta);
            onOpen(conversationImages, globalIndex >= 0 ? globalIndex : 0);
          }} />
          {editingId === message.id ? <InlineMessageEditor job={message} onCancel={() => changeEditing(null)} onSubmit={async prompt => { await onEditSubmit(message, prompt); editing.current = null; setEditingId(null); }} /> : <MessagePrompt job={message} onEdit={() => changeEditing(message.id)} onPreview={fileId => { const index = conversationImages.findIndex(image => image.meta === `${message.id}:input:${fileId}`); if (index >= 0) onOpen(conversationImages, index); }} />}
        </div>
        <div className="chat-reply-heading"><Wand2 size={17} /><strong>PicUp</strong><JobStatus status={message.status} /></div>
        <div className="chat-prior-images">{message.outputImages.map((output, index) => {
          const meta = `${message.id}:output:${index}`;
          const globalIndex = conversationImages.findIndex(image => image.meta === meta);
          return <div className="chat-prior-image" key={meta}><button onClick={() => onOpen(conversationImages, globalIndex >= 0 ? globalIndex : 0)} title="预览此版本"><img src={output.url} alt={message.prompt} /><ImageParameters job={message} /></button><button type="button" className="chat-prior-image-edit" onClick={() => onContinue(message, index)} disabled={continuing} aria-label={`继续编辑结果 ${index + 1}`} title="继续编辑"><Pencil size={14} /></button></div>;
        })}</div>
        {message.textOutputs.length > 0 && <div className="chat-text-outputs">{message.textOutputs.map((text, index) => <p key={`${message.id}-text-${index}`}>{text}</p>)}</div>}
        {!message.outputImages.length && message.error && <p className="studio-error">{userMessage(message.error.message)}</p>}
      </article>)}
      {job ? <article className="chat-turn">
        <div className="chat-user-message" data-message-id={job.id} data-role="user" data-reference={Boolean(job.parentJobId)}><MessageAttachments job={job} parent={conversationJobs.find(item => item.id === job.parentJobId)} onPreview={fileId => {
          const meta = `${job.id}:input:${fileId}`;
          const globalIndex = conversationImages.findIndex(image => image.meta === meta);
          onOpen(conversationImages, globalIndex >= 0 ? globalIndex : 0);
        }} />{editingId === job.id ? <InlineMessageEditor job={job} onCancel={() => changeEditing(null)} onSubmit={async prompt => { await onEditSubmit(job, prompt); editing.current = null; setEditingId(null); }} /> : <MessagePrompt job={job} onEdit={() => changeEditing(job.id)} onPreview={fileId => { const index = conversationImages.findIndex(image => image.meta === `${job.id}:input:${fileId}`); if (index >= 0) onOpen(conversationImages, index); }} />}</div>
        <div className="chat-reply-heading"><Wand2 size={17} /><strong>PicUp</strong></div>
        {job.textOutputs.length > 0 && <div className="chat-text-outputs">{job.textOutputs.map((text, index) => <p key={`job-text-${index}`}>{text}</p>)}</div>}
        {content}
      </article> : loading || error ? <p role="status" className="studio-empty">{error ? '对话加载失败，正在重试' : '正在恢复对话'}</p> : <div className="chat-welcome"><span className="welcome-mark"><Wand2 size={28} strokeWidth={1.4} /></span><h1>今天，想创作什么？</h1><div className="welcome-skill-grid" aria-label="技能示例">{studioSkills.map(skill => <button key={skill.id} className="welcome-skill-card" type="button" onClick={() => onSkillSelect(skill.id)}><img src={skill.previewImage} alt="" /><span>{skill.label}</span></button>)}</div></div>}
      <div ref={end} />
    </div>
    {job && away && <button className="studio-icon chat-scroll-bottom" aria-label="回到底部" title="回到底部" onClick={() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}><ArrowDown size={18} /></button>}
  </section>;
}

function InlineMessageEditor({ job, onCancel, onSubmit }: { job: ImageJobRecord; onCancel: () => void; onSubmit: (prompt: string) => Promise<void> }) {
  const [value, setValue] = useState(job.prompt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { textarea.current?.focus({ preventScroll: true }); }, []);
  return <form className="chat-inline-editor" onSubmit={async event => {
    event.preventDefault();
    if (!value.trim() || sending.current) return;
    sending.current = true; setPending(true); setError('');
    try { await onSubmit(value); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '发送失败，请重试'); }
    finally { sending.current = false; setPending(false); }
  }}>
    <div className="chat-inline-editor-files">{job.inputFiles.map((file, index) => <img key={file.id} src={file.url} alt={`参考图 ${index + 1}`} />)}</div>
    <textarea ref={textarea} disabled={pending} value={value} onChange={event => setValue(event.target.value)} aria-label="编辑消息" rows={3} maxLength={4000} />
    {error && <p className="studio-error" role="alert">{error}</p>}
    <div className="chat-inline-editor-actions"><button type="button" className="chat-inline-cancel" disabled={pending} onClick={onCancel}><X size={15} />取消</button><button type="submit" className="chat-inline-send" disabled={pending || !value.trim()}><ArrowUp size={16} />{pending ? '发送中…' : '发送'}</button></div>
  </form>;
}
