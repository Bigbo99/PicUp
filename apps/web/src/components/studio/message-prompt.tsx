import type { ImageJobRecord } from '@picup/shared';

export function MessagePrompt({ job, onPreview }: { job: ImageJobRecord; onPreview: (fileId: string) => void }) {
  return <p>{job.promptParts ? job.promptParts.map((part, index) => part.type === 'text' ? part.text : <button key={index} type="button" className={`prompt-image-mention${part.subjectId ? ' is-subject' : ''}`} title={`预览 ${part.label}`} onClick={() => onPreview(part.fileId)}><img src={job.inputFiles.find(file => file.id === part.fileId)?.url} alt="" /><span>{part.label}</span>{part.subjectId && <small>主体</small>}</button>) : job.prompt}</p>;
}
