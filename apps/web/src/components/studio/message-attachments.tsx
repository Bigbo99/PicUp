'use client';

import { thumbnailUrl } from '@/lib/thumbnail';

import { useQuery } from '@tanstack/react-query';
import { getOutputHashes } from '@/lib/api';
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
    queryFn: ({ signal }) => getOutputHashes(parent!.id, signal)
  });
  return <div className="chat-input-images">{job.inputFiles.map((file, index) => {
    const referenced = Boolean(file.hash && hashes.data?.includes(file.hash));
    return <div className={`chat-attachment${referenced ? ' is-reference' : ''}`} key={file.id}>
      {referenced && <CornerDownRight size={20} aria-label="引用上一轮生成图" />}
      <button type="button" aria-label={`预览参考图 ${index + 1}`} title={referenced ? '引用上一轮生成图' : `参考图 ${index + 1}`} onClick={() => onPreview(file.id)}>
        <img src={thumbnailUrl(file)} alt={`参考图 ${index + 1}`} />
      </button>
    </div>;
  })}</div>;
}
