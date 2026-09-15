'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, Wand2 } from 'lucide-react';
import type { ImageJobRecord } from '@picup/shared';
import { getImageJob } from '@/lib/api';
import { JobStatus } from './canvas';
import type { PreviewImage } from './image-lightbox';
import { userMessage } from '@/lib/user-message';
import { studioSkills } from './skills';
import { MessagePrompt } from './message-prompt';

export function Conversation({ job, loading, error, children, onUpload: _onUpload, onOpen, onSkillSelect }: {
  job?: ImageJobRecord; loading?: boolean; error?: string; children: React.ReactNode | ((images: PreviewImage[]) => React.ReactNode); onUpload: () => void; onOpen: (images: PreviewImage[], index: number) => void; onSkillSelect: (skillId: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLElement>(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
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
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [job?.id, job?.status, parents.data]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (pinned.current) end.current?.scrollIntoView({ block: 'end' }); });
    if (scroll.current) observer.observe(scroll.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { end.current?.scrollIntoView({ block: 'end' }); });
    };
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); };
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
  return <section ref={scroll} className="chat-conversation" aria-label="创作对话" onScroll={event => {
    const element = event.currentTarget;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setAway(!pinned.current);
  }}>
    <div className="chat-thread">
      {parents.isError && <button className="studio-text-button" onClick={() => parents.refetch()}>加载前面的对话失败，重试</button>}
      {parents.data?.map(message => <article className="chat-turn" key={message.id}>
        <div className="chat-user-message" data-role="user">
          <div className="chat-input-images">{message.inputFiles.map((file, index) => {
            const meta = `${message.id}:input:${file.id}`;
            const globalIndex = conversationImages.findIndex(image => image.meta === meta);
            return <button key={file.id} type="button" aria-label={`预览参考图 ${index + 1}`} onClick={() => onOpen(conversationImages, globalIndex >= 0 ? globalIndex : 0)}><img src={file.url} alt={`参考图 ${index + 1}`} /></button>;
          })}</div>
          <MessagePrompt job={message} onPreview={fileId => { const index = conversationImages.findIndex(image => image.meta === `${message.id}:input:${fileId}`); if (index >= 0) onOpen(conversationImages, index); }} />
        </div>
        <div className="chat-reply-heading"><Wand2 size={17} /><strong>PicUp</strong><JobStatus status={message.status} /></div>
        <div className="chat-prior-images">{message.outputImages.map((output, index) => {
          const meta = `${message.id}:output:${index}`;
          const globalIndex = conversationImages.findIndex(image => image.meta === meta);
          return <button key={meta} onClick={() => onOpen(conversationImages, globalIndex >= 0 ? globalIndex : 0)} title="预览此版本"><img src={output.url} alt={message.prompt} /></button>;
        })}</div>
        {message.textOutputs.length > 0 && <div className="chat-text-outputs">{message.textOutputs.map((text, index) => <p key={`${message.id}-text-${index}`}>{text}</p>)}</div>}
        {!message.outputImages.length && message.error && <p className="studio-error">{userMessage(message.error.message)}</p>}
      </article>)}
      {job ? <article className="chat-turn">
        <div className="chat-user-message" data-role="user"><div className="chat-input-images">{job.inputFiles.map((file, index) => {
          const meta = `${job.id}:input:${file.id}`;
          const globalIndex = conversationImages.findIndex(image => image.meta === meta);
          return <button key={file.id} type="button" aria-label={`预览参考图 ${index + 1}`} onClick={() => onOpen(conversationImages, globalIndex >= 0 ? globalIndex : 0)}><img src={file.url} alt={`参考图 ${index + 1}`} /></button>;
        })}</div><MessagePrompt job={job} onPreview={fileId => { const index = conversationImages.findIndex(image => image.meta === `${job.id}:input:${fileId}`); if (index >= 0) onOpen(conversationImages, index); }} /></div>
        <div className="chat-reply-heading"><Wand2 size={17} /><strong>PicUp</strong></div>
        {job.textOutputs.length > 0 && <div className="chat-text-outputs">{job.textOutputs.map((text, index) => <p key={`job-text-${index}`}>{text}</p>)}</div>}
        {content}
      </article> : loading || error ? <p role="status" className="studio-empty">{error ? '对话加载失败，正在重试' : '正在恢复对话'}</p> : <div className="chat-welcome"><span className="welcome-mark"><Wand2 size={28} strokeWidth={1.4} /></span><h1>今天，想创作什么？</h1><div className="welcome-skill-grid" aria-label="技能示例">{studioSkills.map(skill => <button key={skill.id} className="welcome-skill-card" type="button" onClick={() => onSkillSelect(skill.id)}><img src={skill.previewImage} alt="" /><span>{skill.label}</span></button>)}</div></div>}
      <div ref={end} />
    </div>
    {job && away && <button className="studio-icon chat-scroll-bottom" aria-label="回到底部" title="回到底部" onClick={() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}><ArrowDown size={18} /></button>}
  </section>;
}
