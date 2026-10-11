'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Save, Search, X } from 'lucide-react';
import { imageModelPreset, tokenRunSizeFor, type AdminAiConfigResponse, type AdminAiModelConfig, type AdminAiModelInput, type AdminAiProviderConfig, type AdminAiProviderInput, type AiProviderType, type ImageModelPreset, type ImageQuality } from '@picup/shared';
import { createAdminAiModel, createAdminAiProvider, deleteAdminAiModel, deleteAdminAiProvider, getAdminAiConfig, getAvailableAiModels, installAdminAiModels, updateAdminAiMock, updateAdminAiModel, updateAdminAiProvider, updateAdminAiRouting } from '@/lib/admin-api';
import { useNotifications } from '@/components/notification-provider';
import { providerPresets } from './ai-config-presets';
import { EnabledSwitch, RefreshButton, RowActions } from './controls';

const configViews = [['models', '已接入模型'], ['providers', '渠道连接'], ['defaults', '默认模型']] as const;
const providerTypeLabels = Object.fromEntries(Object.entries(providerPresets).map(([type, preset]) => [type, preset.label])) as Record<AiProviderType, string>;

export function AiConfigPanel() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [view, setView] = useState<typeof configViews[number][0]>('models');
  const [providerEditor, setProviderEditor] = useState<{ provider?: AdminAiProviderConfig } | null>(null);
  const [modelEditor, setModelEditor] = useState<{ provider: AdminAiProviderConfig; model: AdminAiModelConfig } | null>(null);
  const [discoveryProvider, setDiscoveryProvider] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const configQuery = useQuery({ queryKey: ['admin', 'ai-config'], queryFn: getAdminAiConfig });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'ai-config'] }),
      queryClient.invalidateQueries({ queryKey: ['models'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'available-models'] })
    ]);
  };
  const providerMutation = useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AdminAiProviderInput }) => id ? updateAdminAiProvider(id, input) : createAdminAiProvider(input),
    onSuccess: async () => { setProviderEditor(null); await refresh(); notifications.success('渠道已保存'); },
    onError: error => notifications.error('保存失败', error.message)
  });
  const quickProvider = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateAdminAiProvider(id, { enabled }),
    onSuccess: refresh, onError: error => notifications.error('更新失败', error.message)
  });
  const modelMutation = useMutation({
    mutationFn: ({ providerId, modelId, patch }: { providerId: string; modelId: string; patch: Partial<AdminAiModelInput> }) => updateAdminAiModel(providerId, modelId, patch),
    onSuccess: refresh, onError: error => notifications.error('更新失败', error.message)
  });
  const mockMutation = useMutation({ mutationFn: updateAdminAiMock, onSuccess: refresh, onError: error => notifications.error('更新失败', error.message) });
  if (configQuery.isLoading) return <div className="admin-config-empty"><Loader2 className="animate-spin" size={24} />正在加载模型配置</div>;
  if (!configQuery.data) return <div className="admin-config-warning" role="alert">{configQuery.error?.message ?? '配置加载失败'}<RefreshButton onClick={() => void configQuery.refetch()} /></div>;
  const config = configQuery.data;
  const allModels = config.providers.flatMap(provider => provider.models.map(model => ({ provider, model })));
  const visibleModels = allModels.filter(({ provider, model }) => (!providerFilter || provider.id === providerFilter) && (model.displayName + ' ' + model.model + ' ' + provider.displayName).toLowerCase().includes(search.toLowerCase().trim()));
  const deleteItem = async (title: string, action: () => Promise<unknown>) => {
    if (!await notifications.confirm({ title, message: '默认模型正在使用的项目无法删除。', confirmText: '删除', cancelText: '取消', tone: 'danger' })) return;
    setActionPending(true);
    try { await action(); await refresh(); notifications.success('已删除'); }
    catch (error) { notifications.error('删除失败', error instanceof Error ? error.message : '请稍后重试'); }
    finally { setActionPending(false); }
  };
  return <div className="admin-config-panel">
    <div className="admin-model-summary"><span><strong>{allModels.filter(({ provider, model }) => provider.enabled && model.enabled).length}</strong> 可用模型</span><span><strong>{config.providers.length}</strong> 个渠道</span><span className="admin-model-summary-note">{config.mockEnabled ? '测试模式' : '真实调用'}</span></div>
    <div className="admin-config-navigation">
      <div className="admin-config-tabs" role="tablist" aria-label="模型服务配置">
        {configViews.map(([id, label], index) => <button key={id} role="tab" id={'config-tab-' + id} aria-controls={'config-view-' + id} aria-selected={view === id} tabIndex={view === id ? 0 : -1} onClick={() => setView(id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % configViews.length : event.key === 'ArrowLeft' ? (index + configViews.length - 1) % configViews.length : event.key === 'Home' ? 0 : event.key === 'End' ? configViews.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setView(configViews[next][0]); document.getElementById('config-tab-' + configViews[next][0])?.focus();
        }}>{label}</button>)}
      </div><RefreshButton busy={configQuery.isFetching} onClick={() => void refresh()} />
    </div>
    {config.mockEnabled && <div className="admin-config-warning" role="status">测试模式已开启，当前不会调用真实模型。</div>}
    <section role="tabpanel" id={'config-view-' + view} aria-labelledby={'config-tab-' + view}>
      {view === 'models' && <>
        <div className="admin-config-toolbar">
          <ConfigSearch value={search} onChange={setSearch} label="搜索模型或渠道" />
          <select className="admin-filter-select" aria-label="筛选渠道" value={providerFilter} onChange={event => setProviderFilter(event.target.value)}><option value="">全部渠道</option>{config.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}</select>
          <span className="admin-result-count">{visibleModels.length} 个模型</span>
          <button className="admin-primary-button" disabled={!config.providers.length} onClick={() => setDiscoveryProvider(providerFilter || config.providers[0].id)}><Plus size={16} />添加模型</button>
        </div>
        <div className="admin-table-wrap"><table className="admin-table admin-config-table" aria-label="已接入模型">
          <thead><tr><th>模型</th><th>渠道</th><th>分辨率</th><th>积分 / 张</th><th>启用</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{visibleModels.map(({ provider, model }) => <tr key={provider.id + '/' + model.model}>
            <td><button className="admin-cell-link" onClick={() => setModelEditor({ provider, model })}>{model.displayName}</button><small className="admin-cell-secondary">{model.model}</small>{Object.values(config.routing).some(target => target.provider === provider.id && target.model === model.model) && <span className="admin-inline-tag">默认</span>}</td>
            <td data-label="渠道">{provider.displayName}{!provider.enabled && <small className="admin-cell-secondary is-warning">渠道已停用</small>}</td>
            <td data-label="分辨率">{model.supportedQualities.join(' / ')}</td>
            <td data-label="积分 / 张">{model.costCredits}</td>
            <td data-label="启用"><EnabledSwitch label={'启用 ' + provider.displayName + ' / ' + model.displayName} checked={model.enabled} disabled={modelMutation.isPending} onChange={enabled => modelMutation.mutate({ providerId: provider.id, modelId: model.model, patch: { enabled } })} /></td>
            <td><div className="admin-row-buttons"><button className="admin-icon-button" title="模型详情" aria-label={'查看 ' + model.displayName} onClick={() => setModelEditor({ provider, model })}><Pencil size={16} /></button><RowActions label={model.displayName + ' 更多操作'} disabled={actionPending} actions={[{ label: '删除模型', onSelect: () => void deleteItem('删除 ' + model.displayName + '？', () => deleteAdminAiModel(provider.id, model.model)), danger: true }]} /></div></td>
          </tr>)}</tbody>
        </table></div>
        {!visibleModels.length && <div className="admin-config-empty">{config.providers.length ? '暂无匹配的模型' : '先连接一个渠道，再选择模型。'}{!config.providers.length && <button className="admin-primary-button" onClick={() => setProviderEditor({})}><Plus size={16} />连接渠道</button>}</div>}
      </>}
      {view === 'providers' && <>
        <div className="admin-config-toolbar"><span className="admin-result-count">{config.providers.length} 个渠道</span><button className="admin-primary-button" onClick={() => setProviderEditor({})}><Plus size={16} />连接渠道</button></div>
        <div className="admin-table-wrap"><table className="admin-table admin-config-table" aria-label="渠道连接"><thead><tr><th>渠道 / 接口地址</th><th>协议</th><th>模型</th><th>密钥</th><th>启用</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{config.providers.map(provider => <tr key={provider.id}>
            <td><button className="admin-cell-link" onClick={() => setProviderEditor({ provider })}>{provider.displayName}</button><small className="admin-cell-secondary">{provider.baseUrl}</small></td><td data-label="协议">{providerTypeLabels[provider.type]}</td>
            <td data-label="模型"><button className="admin-text-button" onClick={() => { setProviderFilter(provider.id); setSearch(''); setView('models'); }}>{provider.models.length} 个</button></td>
            <td data-label="密钥"><span className={provider.apiKeyConfigured ? 'admin-key-status' : 'admin-key-status is-missing'}>{provider.apiKeyConfigured && <Check size={14} />}{provider.apiKeyConfigured ? '已配置' : '未配置'}</span></td>
            <td data-label="启用"><EnabledSwitch label={'启用渠道 ' + provider.displayName} checked={provider.enabled} disabled={quickProvider.isPending} onChange={enabled => quickProvider.mutate({ id: provider.id, enabled })} /></td>
            <td><div className="admin-row-buttons"><button className="admin-icon-button" aria-label={'编辑渠道 ' + provider.displayName} title="编辑连接" onClick={() => setProviderEditor({ provider })}><Pencil size={16} /></button><RowActions label={provider.displayName + ' 更多操作'} disabled={actionPending} actions={[{ label: '选择模型', onSelect: () => setDiscoveryProvider(provider.id) }, { label: '删除渠道', onSelect: () => void deleteItem('删除 ' + provider.displayName + '？', () => deleteAdminAiProvider(provider.id)), danger: true }]} /></div></td>
          </tr>)}</tbody></table></div>
        {!config.providers.length && <div className="admin-config-empty">暂无渠道连接</div>}
      </>}
      {view === 'defaults' && <div className="admin-default-settings"><RoutingControls key={JSON.stringify(config.routing)} config={config} onSaved={refresh} /><AdvancedSettings><div className="admin-setting-row"><span>测试模式</span><EnabledSwitch label="测试模式" checked={config.mockEnabled} disabled={mockMutation.isPending} onChange={enabled => mockMutation.mutate(enabled)} /></div></AdvancedSettings></div>}
    </section>
    {providerEditor && <ProviderEditorDialog key={providerEditor.provider?.id ?? 'new'} provider={providerEditor.provider} providers={config.providers} pending={providerMutation.isPending} onClose={() => { if (!providerMutation.isPending) setProviderEditor(null); }} onSave={input => providerMutation.mutate({ id: providerEditor.provider?.id, input })} />}
    {modelEditor && <ModelDetailsDialog {...modelEditor} onClose={() => setModelEditor(null)} onSaved={refresh} />}
    {discoveryProvider !== null && <ModelDiscoveryDialog initialProvider={discoveryProvider} providers={config.providers} onClose={() => setDiscoveryProvider(null)} onSaved={refresh} />}
  </div>;
}

function ModelDiscoveryDialog({ initialProvider, providers, onClose, onSaved }: { initialProvider: string; providers: AdminAiProviderConfig[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState<'preset' | 'manual'>('preset');
  const [providerId, setProviderId] = useState(initialProvider);
  const [selected, setSelected] = useState<string[]>([]);
  const notifications = useNotifications();
  const query = useQuery({ queryKey: ['admin', 'available-models', providerId], queryFn: () => getAvailableAiModels(providerId), retry: false, enabled: mode === 'preset' });
  const mutation = useMutation({
    mutationFn: () => installAdminAiModels(providerId, selected),
    onSuccess: async result => { await onSaved(); notifications.success('已添加 ' + result.installed + ' 个模型'); onClose(); },
    onError: error => notifications.error('添加失败', error.message)
  });

  return <ConfigDialog title="添加模型" onClose={() => { if (!mutation.isPending) onClose(); }}>
    <div className="admin-model-picker">
      <div className="flex gap-3">
        <div className="flex-1">
          <ConfigSelect label="选择渠道" value={providerId} onChange={value => { if (!mutation.isPending) { setProviderId(value); setSelected([]); } }} options={providers.map(provider => ({ value: provider.id, label: provider.displayName }))} />
        </div>
        {mode === 'preset' && (
          <button
            type="button"
            className="admin-secondary-button h-10 self-end"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            title="重新获取模型列表"
          >
            <RefreshCw size={16} className={query.isFetching ? 'animate-spin' : ''} />
            获取模型
          </button>
        )}
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <button type="button" className={'px-4 py-2 text-sm font-semibold transition-colors ' + (mode === 'preset' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-600 hover:text-slate-900')} onClick={() => setMode('preset')}>从预设选择</button>
        <button type="button" className={'px-4 py-2 text-sm font-semibold transition-colors ' + (mode === 'manual' ? 'border-b-2 border-teal-600 text-teal-600' : 'text-slate-600 hover:text-slate-900')} onClick={() => setMode('manual')}>手动添加</button>
      </div>

      {mode === 'preset' ? <>
        {query.isFetching && <p className="admin-inline-status" role="status"><Loader2 size={16} className="animate-spin" />正在读取渠道模型…</p>}
        {query.error && <div className="admin-config-warning" role="alert">{query.error.message}<button className="admin-secondary-button" onClick={() => void query.refetch()}><RefreshCw size={16} />重试</button></div>}
        {query.data && <>
          <p className="admin-capability-note">{query.data.message}</p>
          <div className="admin-discovery-list">{query.data.models.map(item => {
            const supported = Boolean(item.defaults && item.defaults.supportedRatios.length && item.defaults.supportedQualities.length);
            const disabled = item.installed || !supported || mutation.isPending;
            return <div className={'admin-discovery-item' + (disabled ? ' is-unavailable' : '')} key={item.model}>
              <label><input type="checkbox" disabled={disabled} checked={item.installed || selected.includes(item.model)} onChange={event => setSelected(current => event.target.checked ? [...current, item.model] : current.filter(id => id !== item.model))} /><span><strong>{item.preset?.displayName ?? item.model}</strong><small>{item.model}</small></span><span className="admin-discovery-state">{item.installed ? '已添加' : supported ? item.preset ? '有文档预设' : '使用通用配置' : '缺少配置'}</span></label>
              {item.defaults && <div className="admin-discovery-meta"><span>{item.defaults.supportedQualities.join(' / ')}</span><span>{item.defaults.supportedRatios.length} 种比例</span>{item.preset && <SourceLink preset={item.preset} />}</div>}
            </div>;
          })}</div>
          {!query.data.models.length && <p className="admin-config-empty">当前渠道未找到图像模型。</p>}
          {query.data.omitted > 0 && <p className="admin-capability-note">已过滤 {query.data.omitted} 个非图像模型。</p>}
        </>}
        <div className="admin-dialog-footer"><span>已选 {selected.length} 个</span><button className="admin-secondary-button" disabled={mutation.isPending} onClick={onClose}>取消</button><button className="admin-primary-button" disabled={!selected.length || mutation.isPending || query.isFetching || Boolean(query.error)} onClick={() => mutation.mutate()}>{mutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}添加所选模型</button></div>
      </> : <ManualModelForm providerId={providerId} onClose={onClose} onSaved={onSaved} />}
    </div>
  </ConfigDialog>;
}

function SourceLink({ preset }: { preset: ImageModelPreset }) {
  return <a className="admin-source-link" href={preset.sourceUrl} target="_blank" rel="noreferrer">{preset.sourceLabel}<ExternalLink size={12} /></a>;
}

function ManualModelForm({ providerId, onClose, onSaved }: { providerId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const notifications = useNotifications();
  const [model, setModel] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [qualities, setQualities] = useState<ImageQuality[]>(['1K', '2K', '4K']);
  const [ratios, setRatios] = useState<string[]>(['auto', '1:1', '16:9', '9:16']);
  const [maxInputImages, setMaxInputImages] = useState('6');
  const [costCredits, setCostCredits] = useState('1');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const availableQualities: ImageQuality[] = ['512', '1K', '2K', '4K'];
  const availableRatios = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1'];

  return <form className="grid gap-4" onSubmit={async event => {
    event.preventDefault();
    setError('');
    if (!model.trim() || !displayName.trim()) {
      setError('请填写模型 ID 和显示名称');
      return;
    }
    if (!qualities.length || !ratios.length) {
      setError('请至少选择一个分辨率和一个比例');
      return;
    }
    const maxImages = Number(maxInputImages);
    const credits = Number(costCredits);
    if (!Number.isInteger(maxImages) || maxImages < 0 || !Number.isInteger(credits) || credits < 0) {
      setError('参考图上限和积分须为非负整数');
      return;
    }

    setPending(true);
    try {
      await createAdminAiModel(providerId, {
        model: model.trim(),
        displayName: displayName.trim(),
        description: '',
        enabled: true,
        priority: 100,
        maxInputImages: maxImages,
        supportedRatios: ratios,
        supportedQualities: qualities,
        costCredits: credits
      });
      await onSaved();
      notifications.success('模型已添加');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setPending(false);
    }
  }}>
    <p className="text-sm text-slate-600">手动添加自定义模型,适合渠道新上线的模型或特殊模型配置。</p>

    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label="模型 ID" value={model} onChange={setModel} placeholder="例如 gpt-image-3" />
      <TextField label="显示名称" value={displayName} onChange={setDisplayName} placeholder="例如 GPT Image 3" />
    </div>

    <fieldset className="grid gap-2">
      <legend className="text-sm font-bold text-slate-700">支持的分辨率</legend>
      <div className="flex flex-wrap gap-2">
        {availableQualities.map(quality => <label key={quality} className="admin-check-label">
          <input type="checkbox" checked={qualities.includes(quality)} onChange={event => setQualities(current => event.target.checked ? [...current, quality] : current.filter(q => q !== quality))} />
          {quality}
        </label>)}
      </div>
    </fieldset>

    <fieldset className="grid gap-2">
      <legend className="text-sm font-bold text-slate-700">支持的宽高比</legend>
      <div className="flex flex-wrap gap-2">
        {availableRatios.map(ratio => <label key={ratio} className="admin-check-label">
          <input type="checkbox" checked={ratios.includes(ratio)} onChange={event => setRatios(current => event.target.checked ? [...current, ratio] : current.filter(r => r !== ratio))} />
          {ratio === 'auto' ? '自动' : ratio}
        </label>)}
      </div>
    </fieldset>

    <div className="grid gap-3 sm:grid-cols-2">
      <TextField label="参考图上限" value={maxInputImages} onChange={setMaxInputImages} inputMode="numeric" />
      <TextField label="每张消耗积分" value={costCredits} onChange={setCostCredits} inputMode="numeric" />
    </div>

    {error && <p className="admin-config-warning" role="alert">{error}</p>}
    <div className="admin-dialog-footer">
      <button type="button" className="admin-secondary-button" disabled={pending} onClick={onClose}>取消</button>
      <button type="submit" className="admin-primary-button" disabled={pending}>
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        添加模型
      </button>
    </div>
  </form>;
}

function ModelDetailsDialog({ provider, model, onClose, onSaved }: { provider: AdminAiProviderConfig; model: AdminAiModelConfig; onClose: () => void; onSaved: () => Promise<void> }) {
  const preset = imageModelPreset(provider.type, model.model);
  const [displayName, setDisplayName] = useState(model.displayName);
  const [qualities, setQualities] = useState<ImageQuality[]>([...model.supportedQualities]);
  const [ratios, setRatios] = useState<string[]>([...model.supportedRatios]);
  const [maxInputImages, setMaxInputImages] = useState(String(model.maxInputImages));
  const [credits, setCredits] = useState(String(model.costCredits));
  const [enabled, setEnabled] = useState(model.enabled);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const notifications = useNotifications();

  const availableQualities: ImageQuality[] = ['512', '1K', '2K', '4K'];
  const availableRatios = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1'];

  return <ConfigDialog title={model.displayName} onClose={() => { if (!pending) onClose(); }}>
    <p className="admin-editor-context">{provider.displayName} · {model.model}</p>

    <form className="grid gap-4" onSubmit={async event => {
      event.preventDefault();
      setError('');
      const value = Number(credits);
      const maxImages = Number(maxInputImages);
      if (!displayName.trim()) {
        setError('显示名称不能为空');
        return;
      }
      if (!qualities.length || !ratios.length) {
        setError('请至少选择一个分辨率和一个比例');
        return;
      }
      if (!Number.isInteger(value) || value < 0 || !Number.isInteger(maxImages) || maxImages < 0) {
        setError('参考图上限和积分须为非负整数');
        return;
      }
      setPending(true);
      try {
        await updateAdminAiModel(provider.id, model.model, {
          displayName: displayName.trim(),
          supportedQualities: qualities,
          supportedRatios: ratios,
          maxInputImages: maxImages,
          costCredits: value,
          enabled
        });
        await onSaved();
        notifications.success('模型已保存');
        onClose();
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '保存失败');
      } finally {
        setPending(false);
      }
    }}>
      <TextField label="显示名称" value={displayName} onChange={setDisplayName} />

      <fieldset className="grid gap-2">
        <legend className="text-sm font-bold text-slate-700">支持的分辨率</legend>
        <div className="flex flex-wrap gap-2">
          {availableQualities.map(quality => <label key={quality} className="admin-check-label">
            <input type="checkbox" checked={qualities.includes(quality)} onChange={event => setQualities(current => event.target.checked ? [...current, quality] : current.filter(q => q !== quality))} />
            {quality}
          </label>)}
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-bold text-slate-700">支持的宽高比</legend>
        <div className="flex flex-wrap gap-2">
          {availableRatios.map(ratio => <label key={ratio} className="admin-check-label">
            <input type="checkbox" checked={ratios.includes(ratio)} onChange={event => setRatios(current => event.target.checked ? [...current, ratio] : current.filter(r => r !== ratio))} />
            {ratio === 'auto' ? '自动' : ratio}
          </label>)}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="参考图上限" value={maxInputImages} onChange={setMaxInputImages} inputMode="numeric" />
        <TextField label="每张消耗积分" value={credits} onChange={setCredits} inputMode="numeric" />
        <div className="admin-setting-row items-center">
          <span className="text-sm font-bold text-slate-700">启用模型</span>
          <EnabledSwitch label="启用此模型" checked={enabled} disabled={pending} onChange={setEnabled} />
        </div>
      </div>

      {preset && <details className="border-t border-slate-200 pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-600">官方文档参数</summary>
        <dl className="admin-capability-grid mt-3">
          <dt>文档分辨率</dt><dd>{preset.resolutions.join(' / ')}</dd>
          <dt>文档比例</dt><dd>{preset.ratios.length} 种</dd>
          <dt>参考图上限</dt><dd>{preset.referenceLimit} 张</dd>
          <dt>参数来源</dt><dd><SourceLink preset={preset} /></dd>
        </dl>
        <p className="admin-capability-note mt-2">{preset.sizeDescription}</p>
        {preset.renderQualities && <p className="admin-capability-note">官方渲染质量 quality:{preset.renderQualities.join(' / ')}。当前渠道:{provider.imageQuality ? '固定 ' + provider.imageQuality : '1K 使用 low,2K 使用 medium,4K 使用 high'}。</p>}
        {preset.renderQualities && <PixelSizePreview model={model} preset={preset} />}
        <button type="button" className="admin-secondary-button mt-2" disabled={pending} onClick={async () => {
          setPending(true);
          setError('');
          try {
            await installAdminAiModels(provider.id, [model.model]);
            await onSaved();
            notifications.success('已应用文档预设,保留渠道现有限制');
            onClose();
          } catch (presetError) {
            setError(presetError instanceof Error ? presetError.message : '应用失败');
          } finally {
            setPending(false);
          }
        }}>{pending && <Loader2 size={16} className="animate-spin" />}应用文档预设</button>
      </details>}

      {error && <p className="admin-config-warning" role="alert">{error}</p>}
      <DialogActions pending={pending} onClose={() => { if (!pending) onClose(); }} />
    </form>
  </ConfigDialog>;
}

function PixelSizePreview({ model, preset }: { model: AdminAiModelConfig; preset: ImageModelPreset }) {
  const ratios = model.supportedRatios.filter(ratio => preset.ratios.includes(ratio));
  const [ratio, setRatio] = useState(ratios.includes('1:1') ? '1:1' : ratios[0] ?? 'auto');
  return <details className="admin-pixel-preview"><summary>查看请求像素尺寸</summary>
    <ConfigSelect label="预览比例" value={ratio} onChange={setRatio} options={ratios.map(value => ({ value, label: value === 'auto' ? '自动' : value }))} />
    <dl className="admin-capability-grid">{model.supportedQualities.filter(value => preset.resolutions.includes(value)).map(resolution => <div key={resolution}><dt>{resolution}</dt><dd>{ratio === 'auto' ? '由模型决定尺寸' : tokenRunSizeFor(ratio, resolution).replace('x', ' × ') + ' px'}</dd></div>)}</dl>
    <p className="admin-capability-note">1K / 2K / 4K 是 PicUp 的分辨率档位；实际请求尺寸随比例变化，渠道返回尺寸以结果为准。</p>
  </details>;
}

function ProviderEditorDialog({ provider, providers, pending, onClose, onSave }: { provider?: AdminAiProviderConfig; providers: AdminAiProviderConfig[]; pending: boolean; onClose: () => void; onSave: (input: AdminAiProviderInput) => void }) {
  const [type, setType] = useState<AiProviderType>(provider?.type ?? 'openai-images');
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? providerPresets['openai-images'].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [fallbackOnly, setFallbackOnly] = useState(provider?.fallbackOnly ?? false);
  const [fallbacks, setFallbacks] = useState(provider?.fallbackProviderIds ?? []);
  const [timeout, setTimeoutValue] = useState(String((provider?.timeoutMs ?? 600000) / 1000));
  const [concurrency, setConcurrency] = useState(String(provider?.concurrency ?? 4));
  const [rpm, setRpm] = useState(String(provider?.rpm ?? 0));
  const [error, setError] = useState('');
  return <ConfigDialog title={provider ? '编辑渠道' : '连接渠道'} onClose={onClose}><form className="grid gap-4" onSubmit={event => {
    event.preventDefault(); setError('');
    const timeoutMs = Number(timeout) * 1000, concurrencyValue = Number(concurrency), rpmValue = Number(rpm);
    if (!displayName.trim() || !baseUrl.trim() || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(concurrencyValue) || concurrencyValue < 1 || concurrencyValue > 1000 || !Number.isInteger(rpmValue) || rpmValue < 0 || rpmValue > 1000000) { setError('请填写名称、有效地址与正确的限额'); return; }
    if (!provider && !apiKey.trim()) { setError('请填写渠道 API Key'); return; }
    onSave({ id: provider?.id ?? type + '-' + crypto.randomUUID().slice(0, 8), type, displayName: displayName.trim(), baseUrl: baseUrl.trim(), enabled,
      ...(apiKey.trim() && !clearApiKey ? { apiKey: apiKey.trim() } : {}), ...(clearApiKey ? { clearApiKey: true } : {}),
      paths: provider && provider.type === type ? provider.paths : providerPresets[type].paths,
      defaultModel: provider?.defaultModel ?? '', aliases: provider?.aliases ?? [], fallbackOnly, fallbackProviderIds: fallbacks,
      timeoutMs, concurrency: concurrencyValue, rpm: rpmValue });
  }}>
    <div className="grid gap-3 sm:grid-cols-2"><ConfigSelect label="接口类型" value={type} options={Object.entries(providerTypeLabels).map(([value, label]) => ({ value, label }))} onChange={value => {
      const next = value as AiProviderType; if (baseUrl === providerPresets[type].baseUrl) setBaseUrl(providerPresets[next].baseUrl); setType(next);
    }} /><TextField label="渠道名称" value={displayName} onChange={setDisplayName} placeholder="例如 DouFu" /></div>
    <TextField label="接口地址" value={baseUrl} onChange={setBaseUrl} type="url" placeholder="https://api.example.com" />
    <TextField label={provider?.apiKeyConfigured ? 'API Key（留空保留）' : 'API Key'} value={apiKey} onChange={setApiKey} type="password" disabled={clearApiKey} />
    <div className="admin-setting-row"><span>启用渠道</span><EnabledSwitch label="启用渠道" checked={enabled} onChange={setEnabled} /></div>
    <AdvancedSettings><div className="grid gap-3 sm:grid-cols-3"><TextField label="超时（秒）" value={timeout} onChange={setTimeoutValue} inputMode="numeric" /><TextField label="最大并发" value={concurrency} onChange={setConcurrency} inputMode="numeric" /><TextField label="每分钟请求（0 不限）" value={rpm} onChange={setRpm} inputMode="numeric" /></div>
      <label className="admin-check-label"><input type="checkbox" checked={fallbackOnly} onChange={event => setFallbackOnly(event.target.checked)} />仅作为备用渠道</label>
      <fieldset className="admin-fallback-list"><legend>失败时使用的备用渠道</legend>{providers.filter(item => item.id !== provider?.id).map(item => <label className="admin-check-label" key={item.id}><input type="checkbox" checked={fallbacks.includes(item.id)} onChange={event => setFallbacks(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.displayName}</label>)}</fieldset>
      {provider?.apiKeyConfigured && <label className="admin-check-label"><input type="checkbox" checked={clearApiKey} onChange={event => setClearApiKey(event.target.checked)} />清除已保存的密钥</label>}
    </AdvancedSettings>
    {error && <p className="admin-config-warning" role="alert">{error}</p>}<DialogActions pending={pending} onClose={onClose} />
  </form></ConfigDialog>;
}

function RoutingControls({ config, onSaved }: { config: AdminAiConfigResponse; onSaved: () => Promise<void> }) {
  const notifications = useNotifications();
  const options = config.providers.filter((provider) => provider.enabled && !provider.fallbackOnly).flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({
    value: JSON.stringify({ provider: provider.id, model: model.model }),
    label: `${provider.displayName} / ${model.displayName}`
  })));
  const [defaultTarget, setDefaultTarget] = useState(JSON.stringify({ provider: config.routing.default.provider, model: config.routing.default.model }));
  const [professionalTarget, setProfessionalTarget] = useState(JSON.stringify({ provider: config.routing.professional.provider, model: config.routing.professional.model }));
  const [pending, setPending] = useState(false);

  return (
    <div className="admin-routing-settings">
      <ConfigSelect label="日常生成" value={defaultTarget} options={options} onChange={setDefaultTarget} />
      <ConfigSelect label="专业任务" value={professionalTarget} options={options} onChange={setProfessionalTarget} />
      <button
        type="button"
        className="admin-primary-button"
        disabled={pending || !options.some((option) => option.value === defaultTarget) || !options.some((option) => option.value === professionalTarget) || (defaultTarget === JSON.stringify({ provider: config.routing.default.provider, model: config.routing.default.model }) && professionalTarget === JSON.stringify({ provider: config.routing.professional.provider, model: config.routing.professional.model }))}
        onClick={async () => {
          setPending(true);
          try {
            await updateAdminAiRouting({
              default: JSON.parse(defaultTarget),
              professional: JSON.parse(professionalTarget)
            });
            await onSaved();
            notifications.success('自动路由已保存');
          } catch (error) {
            notifications.error('路由保存失败', error instanceof Error ? error.message : '请检查目标模型');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
        保存默认模型
      </button>
    </div>
  );
}

function ConfigDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog ref={dialog} className="admin-dialog admin-config-dialog admin-config-modal" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
        <header className="mb-5 flex items-center justify-between gap-3">
          <h2 className="min-w-0 break-words text-xl font-black text-[#083b2d]">{title}</h2>
          <button type="button" className="admin-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        {children}
    </dialog>
  );
}

function DialogActions({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-4">
      <button type="button" className="admin-secondary-button" onClick={onClose}>取消</button>
      <button type="submit" className="admin-primary-button" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
        保存
      </button>
    </div>
  );
}

function TextField({ label, value, onChange, onBlur, placeholder, disabled, type = 'text', inputMode }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <label className="grid gap-1.5 text-sm font-bold text-slate-700">
      {label}
      <input
        className="h-11 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-600 disabled:bg-slate-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        type={inputMode === 'numeric' ? 'number' : type}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        inputMode={inputMode}
      />
    </label>
  );
}

function ConfigSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5 text-sm font-bold text-slate-700">
      {label}
      <select className="admin-field-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function AdvancedSettings({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-3 border-t border-slate-200 pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-600">高级设置</summary>
      <div className="mt-4 grid gap-3">{children}</div>
    </details>
  );
}

function ConfigSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <label className="admin-search-box"><Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} aria-label={label} /></label>;
}
