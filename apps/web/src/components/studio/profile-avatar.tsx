'use client';
import { useState } from 'react';
import { UserRound } from 'lucide-react';

export function ProfileAvatar({ url, size = 25 }: { url?: string | null; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <UserRound size={size} />;
  return <img src={url} alt="头像" width={size * 2} height={size * 2} referrerPolicy="no-referrer" onError={() => setFailed(url)} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />;
}
