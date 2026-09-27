'use client';

import { useQuery } from '@tanstack/react-query';
import { CornerDownRight } from 'lucide-react';
import type { ImageJobRecord } from '@picup/shared';

export function MessageAttachments({ job, parent, onPreview }: {
  job: ImageJobRecord;
  parent?: ImageJobRecord;
  onPreview: (fileId: string) => void;
}) {
  const hashes = useQuery({
    queryKey: ['output-image-hashes', parent?.id, parent?.outputImages.map(image => image.url)],
    enabled: Boolean(parent?.outputImages.length && job.inputFiles.some(file => file.hash)),
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => Promise.all(parent!.outputImages.map(async image => {
      const response = await fetch(image.url, { signal });
      if (!response.ok) throw new Error('无法读取引用图片');
      const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }))
  });
  return <div className="chat-input-images">{job.inputFiles.map((file, index) => {
    const referenced = Boolean(file.hash && hashes.data?.includes(file.hash));
    return <div className={`chat-attachment${referenced ? ' is-reference' : ''}`} key={file.id}>
      {referenced && <CornerDownRight size={20} aria-label="引用上一轮生成图" />}
      <button type="button" aria-label={`预览参考图 ${index + 1}`} title={referenced ? '引用上一轮生成图' : `参考图 ${index + 1}`} onClick={() => onPreview(file.id)}>
        <img src={file.url} alt={`参考图 ${index + 1}`} />
      </button>
    </div>;
  })}</div>;
}
