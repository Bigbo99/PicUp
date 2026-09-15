'use client';

import { useEffect, useReducer, useState } from 'react';
import type { ImageJobCreateRequest, ImageQuality, UploadedFileRecord, PromptPart } from '@picup/shared';
import { displayFile } from '@/lib/api';

export type StudioDraft = {
  prompt: string; provider: string; model: string; aspectRatio: string; quality: ImageQuality;
  promptParts?: PromptPart[];
  files: UploadedFileRecord[]; parentJobId?: string; idempotencyKey?: string; awaitingJobId?: string;
  pendingPayment?: { orderId: string; input: ImageJobCreateRequest };
};
export const emptyDraft: StudioDraft = { prompt: '', promptParts: undefined, provider: 'auto', model: 'auto', aspectRatio: 'auto', quality: '1K', files: [] };

export function useStudioDraft(userId?: string) {
  const [draft, update] = useReducer((state: StudioDraft, patch: Partial<StudioDraft>) => ({ ...state, ...patch }), emptyDraft);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = userId ? `picup:studio:${userId}` : null;
  useEffect(() => {
    if (!key) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as StudioDraft | null;
      update(saved && typeof saved.prompt === 'string' && Array.isArray(saved.files) ? { ...emptyDraft, ...saved, files: saved.files.map(displayFile) } : emptyDraft);
    } catch { update(emptyDraft); }
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (!key || loadedKey !== key) return;
    try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* Storage can be disabled in private sessions. */ }
  }, [draft, key, loadedKey]);
  return { draft, update, ready: Boolean(key && key === loadedKey), clear: () => {
    update({ ...emptyDraft, promptParts: undefined, parentJobId: undefined, idempotencyKey: undefined, awaitingJobId: undefined, pendingPayment: undefined });
    if (key) sessionStorage.removeItem(key);
  } };
}
