'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ImageJobRecord } from '@picup/shared';

export function MessagePrompt({ job, onPreview }: { job: ImageJobRecord; onPreview: (fileId: string) => void }) {
  const id = useId();
  const prompt = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => { setExpanded(false); }, [job.id]);
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
    <p ref={prompt} id={id} className={expanded ? undefined : 'message-prompt-collapsed'}>{job.promptParts ? job.promptParts.map((part, index) => part.type === 'text' ? part.text : <button key={index} type="button" className={`prompt-image-mention${part.subjectId ? ' is-subject' : ''}`} title={`预览 ${part.label}`} onFocus={() => setExpanded(true)} onClick={() => onPreview(part.fileId)}><img src={job.inputFiles.find(file => file.id === part.fileId)?.url} alt="" /><span>{part.label}</span>{part.subjectId && <small>主体</small>}</button>) : job.prompt}</p>
    {overflowing && <button type="button" className="studio-text-button message-prompt-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '展开全文'}{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>}
  </div>;
}
