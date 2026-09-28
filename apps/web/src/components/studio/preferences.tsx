'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ModelsResponse } from '@picup/shared';
import { getStudioPreferences, saveStudioPreferences, type StudioPreferences } from '@/lib/api';
import { selectedUserModel, userModelGuidance, userModels } from './user-models';

export const defaultPreferences: StudioPreferences = { theme: 'system', quality: '1K', aspectRatio: 'auto', provider: 'auto', model: 'auto' };
export function usePreferences(userId?: string, controlTheme = false) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['studio-preferences', userId], queryFn: getStudioPreferences, enabled: Boolean(userId) });
  const preferences = { ...defaultPreferences, ...query.data };
  const save = useMutation({ mutationFn: saveStudioPreferences, onSuccess: data => { client.setQueryData(['studio-preferences', userId], (old: Partial<StudioPreferences> | undefined) => ({ ...old, ...data })); window.dispatchEvent(new CustomEvent('picup:preferences-updated', { detail: data })); } });
  useEffect(() => {
    if (!controlTheme) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.studioTheme = preferences.theme === 'system' ? media.matches ? 'dark' : 'light' : preferences.theme; };
    apply(); try { localStorage.setItem('picup:theme', preferences.theme); } catch { /* Storage may be unavailable. */ } media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme, controlTheme]);
  return { preferences, save, loaded: query.isSuccess };
}

export function PreferenceFields({ value, onChange, pending, error, models }: { value: StudioPreferences; onChange: (patch: Partial<StudioPreferences>) => void; pending: boolean; error?: string; models?: ModelsResponse }) {
  const options = userModels(models);
  const selected = selectedUserModel(options, value.provider, value.model, models?.routing?.default);
  return <section className="account-section"><h3>偏好设置</h3><div className="studio-form">
    <label>外观</label><div className="studio-segments" aria-label="主题模式">{([['system', Monitor, '系统'], ['light', Sun, '浅色'], ['dark', Moon, '深色']] as const).map(([mode, Icon, label]) => <button key={mode} disabled={pending} title={label} aria-label={label} aria-pressed={value.theme === mode} onClick={() => onChange({ theme: mode })}><Icon size={17} />{label}</button>)}</div>
    <label>默认清晰度<select disabled={pending} value={value.quality} onChange={e => onChange({ quality: e.target.value as StudioPreferences['quality'] })}>{['1K', '2K', '4K'].map(item => <option key={item}>{item}</option>)}</select></label>
    <label>默认比例<select disabled={pending} value={value.aspectRatio} onChange={e => onChange({ aspectRatio: e.target.value })}>{['auto', '1:1', '3:4', '4:3', '16:9', '9:16'].map(item => <option key={item} value={item}>{item === 'auto' ? '自动' : item}</option>)}</select></label>
    <label>默认模型<select disabled={pending || !options.length} value={value.provider === 'auto' ? 'auto' : selected ? `${selected.provider}:${selected.model}` : ''} onChange={e => { if (e.target.value === 'auto') { onChange({ provider: 'auto', model: 'auto' }); return; } const model = options.find(item => `${item.provider}:${item.model}` === e.target.value); if (model) onChange({ provider: model.provider, model: model.model }); }}><option value="auto">自动推荐</option>{!selected && <option value="" disabled>暂不可用</option>}{options.map(model => <option key={`${model.provider}:${model.model}`} value={`${model.provider}:${model.model}`}>{model.displayName}</option>)}</select></label>
    {(value.provider === 'auto' || selected) && <p className="model-guidance">{userModelGuidance(value.provider === 'auto' ? 'auto' : selected!.model)}</p>}
    {pending && <p role="status">保存中</p>}{error && <p role="alert" className="studio-error">{error}</p>}
  </div></section>;
}
