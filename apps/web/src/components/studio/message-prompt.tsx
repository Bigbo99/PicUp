'use client';

import { thumbnailUrl } from '@/lib/thumbnail';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Pencil } from 'lucide-react';
import type { ImageJobRecord } from '@picup/shared';

export function MessagePrompt({ job, onPreview, onEdit }: { job: ImageJobRecord; onPreview: (fileId: string) => void; onEdit: (job: ImageJobRecord) => void }) {
  const id = useId();
  const prompt = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setExpanded(false); }, [job.id]);
  useEffect(() => { setCopied(false); }, [job.id]);
  useEffect(() => {
    const element = prompt.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollHeight > Number.parseFloat(getComputedStyle(element).lineHeight) * 4 + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [job.prompt, job.promptParts]);

  return <div className="message-prompt">
    <p ref={prompt} id={id} className={expanded ? undefined : 'message-prompt-collapsed'}>{job.promptParts ? job.promptParts.map((part, index) => part.type === 'text' ? part.text : <button key={index} type="button" className={`prompt-image-mention${part.subjectId ? ' is-subject' : ''}`} title={`预览 ${part.label}`} onFocus={() => setExpanded(true)} onClick={() => onPreview(part.fileId)}><img src={job.inputFiles.find(file => file.id === part.fileId) ? thumbnailUrl(job.inputFiles.find(file => file.id === part.fileId)!) : undefined} alt="" /><span>{part.label}</span>{part.subjectId && <small>主体</small>}</button>) : job.prompt}</p>
    <div className="message-prompt-actions">
      {overflowing && <button type="button" className="studio-text-button message-prompt-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '展开全文'}{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>}
      <button type="button" className="studio-text-button message-prompt-action message-prompt-copy" onClick={async () => { try { await navigator.clipboard.writeText(job.prompt); } catch { const area = document.createElement('textarea'); area.value = job.prompt; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); } setCopied(true); window.setTimeout(() => setCopied(false), 1400); }} title="复制消息" aria-label="复制消息">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
      <button type="button" className="studio-text-button message-prompt-action message-prompt-edit" onClick={() => onEdit(job)} title="编辑这条消息" aria-label="编辑这条消息"><Pencil size={16} /></button>
    </div>
  </div>;
}
