'use client';

import { useState } from 'react';

// Keep edits only while the preview is mounted; reopening starts with a clean draft.
export function usePreviewDraft<T>(key: string, initial: T): [T, (value: T) => void] {
  const [entries, setEntries] = useState<Record<string, T>>({});
  return [entries[key] ?? initial, next => {
    setEntries(previous => ({ ...previous, [key]: next }));
  }];
}
