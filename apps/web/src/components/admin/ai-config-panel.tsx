'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, ChevronRight, Loader2, Pencil, Plus, Save, Search, X } from 'lucide-react';
import type {
  AdminAiConfigResponse,
  AdminAiModelConfig,
  AdminAiModelInput,
  AdminAiProviderConfig,
  AdminAiProviderInput,
  AiProviderType,
  ImageQuality
} from '@picup/shared';
import {
  createAdminAiModel,
  createAdminAiProvider,
  deleteAdminAiModel,
  deleteAdminAiProvider,
  getAdminAiConfig,
  syncAdminAiModels,
  updateAdminAiMock,
  updateAdminAiModel,
  updateAdminAiProvider,
  updateAdminAiRouting
} from '@/lib/admin-api';
import { useNotifications } from '@/components/notification-provider';
import { pathLabels, providerPresets } from './ai-config-presets';
import { EnabledSwitch, RefreshButton, RowActions } from './controls';

const configViews = [['providers', '服务商连接'], ['models', '模型目录'], ['defaults', '默认调用']] as const;

type ProviderEditorState = { provider?: AdminAiProviderConfig } | null;
type ModelEditorState = { providerId: string; model?: AdminAiModelConfig; template?: AdminAiModelConfig } | null;

const providerTypeLabels = Object.fromEntries(Object.entries(providerPresets).map(([type, preset]) => [type, preset.label])) as Record<AiProviderType, string>;

export function AiConfigPanel() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [providerEditor, setProviderEditor] = useState<ProviderEditorState>(null);
  const [modelEditor, setModelEditor] = useState<ModelEditorState>(null);
  const [view, setView] = useState<typeof configViews[number][0]>('providers');
  const [providerSearch, setProviderSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const configQuery = useQuery({ queryKey: ['admin', 'ai-config'], queryFn: getAdminAiConfig });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'ai-config'] });
    await queryClient.invalidateQueries({ queryKey: ['models'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'providers'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const providerMutation = useMutation({
    mutationFn: async ({ providerId, input }: { providerId?: string; input: AdminAiProviderInput }) => providerId
      ? updateAdminAiProvider(providerId, input)
      : createAdminAiProvider(input),
    onSuccess: async () => {
      setProviderEditor(null);
      await refresh();
      notifications.success('服务商配置已保存');
    },
    onError: (error) => notifications.error('服务商保存失败', error instanceof Error ? error.message : '请检查配置')
  });

  const modelMutation = useMutation({
    mutationFn: async ({ providerId, modelId, input }: { providerId: string; modelId?: string; input: AdminAiModelInput }) => modelId
      ? updateAdminAiModel(providerId, modelId, input)
      : createAdminAiModel(providerId, input),
    onSuccess: async () => {
      setModelEditor(null);
      await refresh();
      notifications.success('模型配置已保存');
    },
    onError: (error) => notifications.error('模型保存失败', error instanceof Error ? error.message : '请检查配置')
  });

  const quickProviderMutation = useMutation({
    mutationFn: ({ providerId, patch }: { providerId: string; patch: Partial<AdminAiProviderInput> }) => updateAdminAiProvider(providerId, patch),
    onSuccess: refresh,
    onError: (error) => notifications.error('服务商更新失败', error instanceof Error ? error.message : '请稍后重试')
  });

  const quickModelMutation = useMutation({
    mutationFn: ({ providerId, modelId, patch }: { providerId: string; modelId: string; patch: Partial<AdminAiModelInput> }) => updateAdminAiModel(providerId, modelId, patch),
    onSuccess: refresh,
    onError: (error) => notifications.error('模型更新失败', error instanceof Error ? error.message : '请稍后重试')
  });

  const syncMutation = useMutation({
    mutationFn: syncAdminAiModels,
    onSuccess: async (result) => {
      await refresh();
      notifications.success('模型同步完成', `获取 ${result.fetched} 个，新增 ${result.added} 个，已有 ${result.existing} 个`);
    },
    onError: (error) => notifications.error('模型同步失败', error instanceof Error ? error.message : '请检查地址和密钥')
  });

  const mockMutation = useMutation({
    mutationFn: updateAdminAiMock,
    onSuccess: refresh,
    onError: (error) => notifications.error('测试模式更新失败', error instanceof Error ? error.message : '请稍后重试')
  });

  if (configQuery.isLoading) {
    return <div className="flex min-h-48 items-center justify-center text-slate-500"><Loader2 className="animate-spin" size={24} /></div>;
  }
  if (configQuery.error || !configQuery.data) {
    return <div className="admin-config-warning" role="alert"><span>{configQuery.error instanceof Error ? configQuery.error.message : '模型配置加载失败'}</span><RefreshButton busy={configQuery.isFetching} onClick={() => void configQuery.refetch()} /></div>;
  }

  const config = configQuery.data;
  const visibleProviders = config.providers.filter((provider) => `${provider.displayName} ${provider.baseUrl}`.toLowerCase().includes(providerSearch.trim().toLowerCase()));
  const visibleModels = config.providers.filter((provider) => !providerFilter || provider.id === providerFilter).flatMap((provider) => provider.models.map((model) => ({ provider, model }))).filter(({ model }) => `${model.displayName} ${model.model}`.toLowerCase().includes(modelSearch.trim().toLowerCase()));
  const confirmAction = async (title: string, message: string, action: () => Promise<unknown>) => {
    if (!await notifications.confirm({ title, message, confirmText: '确认', cancelText: '取消', tone: 'danger' })) return;
    setActionPending(true);
    try {
      await action();
      await refresh();
      notifications.success('操作已完成');
    } catch (error) {
      notifications.error('操作失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className="admin-config-panel">
      <div className="admin-config-navigation">
        <div className="admin-config-tabs" role="tablist" aria-label="模型服务配置">
          {configViews.map(([id, label]) => <button key={id} type="button" role="tab" id={`config-tab-${id}`} aria-controls={`config-view-${id}`} aria-selected={view === id} tabIndex={view === id ? 0 : -1} onClick={() => setView(id)} onKeyDown={(event) => {
            const index = configViews.findIndex(([key]) => key === id);
            const next = event.key === 'ArrowRight' ? (index + 1) % configViews.length : event.key === 'ArrowLeft' ? (index + configViews.length - 1) % configViews.length : event.key === 'Home' ? 0 : event.key === 'End' ? configViews.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            setView(configViews[next][0]);
            document.getElementById(`config-tab-${configViews[next][0]}`)?.focus();
          }}>{label}</button>)}
        </div>
        <RefreshButton busy={configQuery.isFetching} onClick={() => void refresh()} />
      </div>
      {config.mockEnabled && <div className="admin-config-warning" role="status">测试模式已开启，当前不会调用真实模型。<button type="button" onClick={() => setView('defaults')}>管理</button></div>}

      <section role="tabpanel" id={`config-view-${view}`} aria-labelledby={`config-tab-${view}`}>
        {view === 'providers' && <>
          <div className="admin-config-toolbar">
            <ConfigSearch value={providerSearch} onChange={setProviderSearch} label="搜索服务商" />
            <span className="admin-result-count">{visibleProviders.length} 个连接</span>
            <button type="button" className="admin-primary-button" onClick={() => setProviderEditor({})}><Plus size={16} />添加服务商</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table admin-config-table" aria-label="服务商连接">
              <thead><tr><th>服务商 / 接口地址</th><th>接口协议</th><th>模型</th><th>密钥</th><th>启用</th><th><span className="sr-only">操作</span></th></tr></thead>
              <tbody>{visibleProviders.map((provider) => <tr key={provider.id}>
                <td><button className="admin-cell-link" onClick={() => setProviderEditor({ provider })}>{provider.displayName}</button><small className="admin-cell-secondary">{provider.baseUrl}</small></td>
                <td data-label="接口协议">{providerTypeLabels[provider.type]}</td>
                <td data-label="模型"><button className="admin-text-button" onClick={() => { setProviderFilter(provider.id); setModelSearch(''); setView('models'); }}>{provider.models.length} 个<ChevronRight size={14} /></button></td>
                <td data-label="密钥"><span className={provider.apiKeyConfigured ? 'admin-key-status' : 'admin-key-status is-missing'}>{provider.apiKeyConfigured ? <Check size={14} /> : <AlertCircle size={14} />}{provider.apiKeyConfigured ? '已配置' : '未配置'}</span></td>
                <td data-label="启用"><EnabledSwitch label={`启用 ${provider.displayName}`} checked={provider.enabled} disabled={quickProviderMutation.isPending} onChange={(enabled) => quickProviderMutation.mutate({ providerId: provider.id, patch: { enabled } })} /></td>
                <td><div className="admin-row-buttons">
                  <button type="button" className="admin-icon-button" title="编辑连接" aria-label={`编辑 ${provider.displayName} 连接`} onClick={() => setProviderEditor({ provider })}><Pencil size={16} /></button>
                  <RowActions label={`${provider.displayName} 更多操作`} disabled={actionPending} actions={[
                    { label: '添加模型', onSelect: () => setModelEditor({ providerId: provider.id }) },
                    ...(['openai-compatible', 'openai-images'].includes(provider.type) ? [{ label: '同步模型', onSelect: () => syncMutation.mutate(provider.id) }] : []),
                    { label: '清除密钥', disabled: !provider.apiKeyConfigured, onSelect: () => void confirmAction(`清除 ${provider.displayName} 的密钥？`, '清除后无法调用该服务商的模型。', () => updateAdminAiProvider(provider.id, { clearApiKey: true })) },
                    { label: '删除服务商', onSelect: () => void confirmAction(`删除 ${provider.displayName}？`, '服务商及其模型将被移除。默认模型正在使用的服务商不能删除。', () => deleteAdminAiProvider(provider.id)) }
                  ]} />
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          {!visibleProviders.length && <div className="admin-config-empty">{config.providers.length ? '没有匹配的服务商' : '暂无服务商连接'}</div>}
        </>}

        {view === 'models' && <>
          <div className="admin-config-toolbar">
            <ConfigSearch value={modelSearch} onChange={setModelSearch} label="搜索模型" />
            <select className="admin-filter-select" aria-label="筛选服务商" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
              <option value="">全部服务商</option>
              {config.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
            </select>
            <span className="admin-result-count">{visibleModels.length} 个模型</span>
            <button type="button" className="admin-primary-button" disabled={!config.providers.length} onClick={() => setModelEditor({ providerId: config.providers.find((provider) => provider.id === providerFilter)?.id ?? config.providers[0].id })}><Plus size={16} />添加模型</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table admin-config-table" aria-label="模型目录">
              <thead><tr><th>模型 / 标识</th><th>服务商</th><th>清晰度</th><th>参考图</th><th>积分</th><th>启用</th><th><span className="sr-only">操作</span></th></tr></thead>
              <tbody>{visibleModels.map(({ provider, model }) => <tr key={JSON.stringify([provider.id, model.model])}>
                <td><button className="admin-cell-link" onClick={() => setModelEditor({ providerId: provider.id, model })}>{model.displayName}</button><small className="admin-cell-secondary">{model.model}</small></td>
                <td data-label="服务商">{provider.displayName}{!provider.enabled && <small className="admin-cell-secondary is-warning">连接已停用</small>}</td>
                <td data-label="清晰度">{model.supportedQualities.join(' / ')}</td>
                <td data-label="参考图">{model.maxInputImages} 张</td><td data-label="积分">{model.costCredits}</td>
                <td data-label="启用"><EnabledSwitch label={`启用 ${model.displayName}`} checked={model.enabled} disabled={quickModelMutation.isPending} onChange={(enabled) => quickModelMutation.mutate({ providerId: provider.id, modelId: model.model, patch: { enabled } })} /></td>
                <td><div className="admin-row-buttons">
                  <button type="button" className="admin-icon-button" title="编辑模型" aria-label={`编辑 ${model.displayName}`} onClick={() => setModelEditor({ providerId: provider.id, model })}><Pencil size={16} /></button>
                  <RowActions label={`${model.displayName} 更多操作`} disabled={actionPending} actions={[
                    { label: '复用模型配置', onSelect: () => setModelEditor({ providerId: provider.id, template: model }) },
                    { label: '删除模型', onSelect: () => void confirmAction(`删除 ${model.displayName}？`, '默认调用正在使用的模型不能删除。', () => deleteAdminAiModel(provider.id, model.model)) }
                  ]} />
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          {!visibleModels.length && <div className="admin-config-empty">{config.providers.length ? '没有匹配的模型' : '暂无模型'}{!config.providers.length && <button type="button" className="admin-text-button" onClick={() => { setView('providers'); setProviderEditor({}); }}>添加服务商</button>}</div>}
        </>}

        {view === 'defaults' && <div className="admin-default-settings">
          <RoutingControls key={JSON.stringify(config.routing)} config={config} onSaved={refresh} />
          <div className="admin-setting-row">
            <span>测试模式</span>
            <EnabledSwitch label="测试模式" checked={config.mockEnabled} disabled={mockMutation.isPending} onChange={(enabled) => mockMutation.mutate(enabled)} />
          </div>
        </div>}
      </section>

      {providerEditor && (
        <ProviderEditorDialog
          key={providerEditor.provider?.id ?? 'new-provider'}
          provider={providerEditor.provider}
          pending={providerMutation.isPending}
          onClose={() => { if (!providerMutation.isPending) setProviderEditor(null); }}
          onSave={(input) => providerMutation.mutate({ providerId: providerEditor.provider?.id, input })}
        />
      )}
      {modelEditor && (
        <ModelEditorDialog
          key={`${modelEditor.providerId}:${modelEditor.model?.model ?? 'new-model'}`}
          providerId={modelEditor.providerId}
          model={modelEditor.model}
          template={modelEditor.template}
          providers={config.providers}
          pending={modelMutation.isPending}
          onClose={() => { if (!modelMutation.isPending) setModelEditor(null); }}
          onSave={(input, providerId) => modelMutation.mutate({ providerId, modelId: modelEditor.model?.model, input })}
        />
      )}
    </div>
  );
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

function ProviderEditorDialog({ provider, pending, onClose, onSave }: {
  provider?: AdminAiProviderConfig;
  pending: boolean;
  onClose: () => void;
  onSave: (input: AdminAiProviderInput) => void;
}) {
  const [id, setId] = useState(provider?.id ?? '');
  const [type, setType] = useState<AiProviderType>(provider?.type ?? 'openai-images');
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '');
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? providerPresets['openai-images'].baseUrl);
  const [paths, setPaths] = useState({ ...(provider?.paths ?? providerPresets['openai-images'].paths) });
  const [defaultModel, setDefaultModel] = useState(provider?.defaultModel ?? '');
  const [aliases, setAliases] = useState((provider?.aliases ?? []).join(', '));
  const [timeoutMs, setTimeoutMs] = useState(String(provider?.timeoutMs ?? 600000));
  const [concurrency, setConcurrency] = useState(String(provider?.concurrency ?? 4));
  const [rpm, setRpm] = useState(String(provider?.rpm ?? 0));
  const [error, setError] = useState('');

  return (
    <ConfigDialog title={provider ? `编辑 ${provider.displayName}` : '添加服务商'} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => {
        event.preventDefault();
        try {
          const timeout = Number(timeoutMs);
          const providerConcurrency = Number(concurrency);
          const providerRpm = Number(rpm);
          if (!displayName.trim() || !baseUrl.trim()
            || !Number.isInteger(timeout) || timeout <= 0
            || !Number.isInteger(providerConcurrency) || providerConcurrency < 1 || providerConcurrency > 1000
            || !Number.isInteger(providerRpm) || providerRpm < 0 || providerRpm > 1000000) {
            throw new Error('请填写服务商名称与有效地址；超时须为正整数，并发 1-1000，RPM 0-1000000');
          }
          onSave({
            id: id.trim() || `${type}-${crypto.randomUUID().slice(0, 8)}`,
            type,
            displayName: displayName.trim(),
            enabled,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            baseUrl: baseUrl.trim(),
            paths,
            defaultModel: defaultModel.trim(),
            aliases: splitList(aliases),
            timeoutMs: timeout,
            concurrency: providerConcurrency,
            rpm: providerRpm
          });
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : '配置格式错误');
        }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            接口协议
            <select className="h-11 rounded-lg border border-slate-200 bg-white px-3" value={type} onChange={(event) => {
              const next = event.target.value as AiProviderType;
              if (baseUrl === providerPresets[type].baseUrl) setBaseUrl(providerPresets[next].baseUrl);
              setType(next);
              setPaths({ ...providerPresets[next].paths });
            }}>
              {Object.entries(providerTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <TextField label="服务商名称" value={displayName} onChange={setDisplayName} placeholder="服务商名称" />
        </div>
        <TextField label="接口地址" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com" type="url" />
        <TextField label={provider?.apiKeyConfigured ? 'API Key（留空保持原值）' : 'API Key'} value={apiKey} onChange={setApiKey} type="password" placeholder="不会返回已保存的密钥" />
        <AdvancedSettings>
        <TextField label="服务商标识" value={id} onChange={setId} disabled={Boolean(provider)} placeholder="自动生成" />
        {provider && <ConfigSelect label="服务商默认模型" value={defaultModel} onChange={setDefaultModel} options={[{ value: '', label: '自动选择' }, ...provider.models.map((model) => ({ value: model.model, label: model.displayName }))]} />}
        <TextField label="兼容服务商标识" value={aliases} onChange={setAliases} placeholder="多个值用逗号分隔" />
        {Object.keys(providerPresets[type].paths).map((key) => {
          const field = key as keyof typeof paths;
          return <TextField key={field} label={pathLabels[field]} value={paths[field] ?? ''} onChange={(value) => setPaths((current) => ({ ...current, [field]: value }))} />;
        })}
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="超时毫秒" value={timeoutMs} onChange={setTimeoutMs} inputMode="numeric" />
          <TextField label="并发数" value={concurrency} onChange={setConcurrency} inputMode="numeric" />
          <TextField label="RPM（0 为不限）" value={rpm} onChange={setRpm} inputMode="numeric" />
        </div>
        </AdvancedSettings>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            启用服务商
          </label>
        </div>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <DialogActions pending={pending} onClose={onClose} />
      </form>
    </ConfigDialog>
  );
}

function ModelEditorDialog({ providerId, model, template, providers, pending, onClose, onSave }: {
  providerId: string;
  model?: AdminAiModelConfig;
  template?: AdminAiModelConfig;
  providers: AdminAiProviderConfig[];
  pending: boolean;
  onClose: () => void;
  onSave: (input: AdminAiModelInput, providerId: string) => void;
}) {
  const initial = model ?? template;
  const [targetProvider, setTargetProvider] = useState(providerId);
  const [modelId, setModelId] = useState(model?.model ?? '');
  const [upstreamModel, setUpstreamModel] = useState(initial?.upstreamModel ?? '');
  const [displayName, setDisplayName] = useState(model?.displayName ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [enabled, setEnabled] = useState(model?.enabled ?? true);
  const [priority, setPriority] = useState(String(initial?.priority ?? 100));
  const [maxInputImages, setMaxInputImages] = useState(String(initial?.maxInputImages ?? 4));
  const [costCredits, setCostCredits] = useState(String(initial?.costCredits ?? 1));
  const [aliases, setAliases] = useState((model?.aliases ?? []).join(', '));
  const [ratios, setRatios] = useState((initial?.supportedRatios ?? ['auto', '1:1', '16:9', '9:16']).join(', '));
  const [qualities, setQualities] = useState<ImageQuality[]>(initial?.supportedQualities ?? ['1K', '2K']);
  const [qualityOverrides, setQualityOverrides] = useState(initial?.qualityModelOverrides ?? {});
  const [fallbackModels, setFallbackModels] = useState((initial?.fallbackModels ?? []).join(', '));
  const [error, setError] = useState('');

  return (
    <ConfigDialog title={model ? `编辑 ${model.displayName}` : template ? `复用 ${template.displayName}` : '添加模型'} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsedQualities = qualities;
          const allowed = new Set<ImageQuality>(['512', '1K', '2K', '4K']);
          if (parsedQualities.some((quality) => !allowed.has(quality))) throw new Error('清晰度仅支持 512、1K、2K、4K');
          const next: AdminAiModelInput = {
            model: modelId.trim(),
            upstreamModel: upstreamModel.trim() || undefined,
            aliases: splitList(aliases),
            displayName: displayName.trim() || modelId.trim(),
            description: description.trim(),
            enabled,
            priority: Number(priority),
            maxInputImages: Number(maxInputImages),
            supportedRatios: splitList(ratios),
            supportedQualities: parsedQualities,
            costCredits: Number(costCredits),
            qualityModelOverrides: qualityOverrides,
            fallbackModels: splitList(fallbackModels)
          };
          if (!next.model || !next.displayName || !Number.isInteger(next.priority) || next.priority! < 0 || !Number.isInteger(next.maxInputImages) || next.maxInputImages < 0 || !Number.isInteger(next.costCredits) || next.costCredits < 0 || !qualities.length || !next.supportedRatios.length) {
            throw new Error('请完整填写模型信息');
          }
          onSave(next, targetProvider);
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : '配置格式错误');
        }
      }}>
        {model ? <div className="admin-editor-context">{providers.find((item) => item.id === providerId)?.displayName}</div> : <ConfigSelect label="所属服务商" value={targetProvider} onChange={setTargetProvider} options={providers.map((item) => ({ value: item.id, label: item.displayName }))} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="模型 ID" value={modelId} onChange={setModelId} disabled={Boolean(model)} placeholder="model-id" />
          <TextField label="显示名称" value={displayName} onChange={setDisplayName} placeholder="默认与模型 ID 相同" />
        </div>
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          模型说明
          <textarea className="min-h-20 rounded-lg border border-slate-200 p-3 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="参考图上限" value={maxInputImages} onChange={setMaxInputImages} inputMode="numeric" />
          <TextField label="积分" value={costCredits} onChange={setCostCredits} inputMode="numeric" />
        </div>
        <TextField label="支持比例" value={ratios} onChange={setRatios} placeholder="auto, 1:1, 16:9" />
        <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-2 font-bold">支持清晰度</legend>{(['512', '1K', '2K', '4K'] as ImageQuality[]).map((quality) => <label key={quality} className="flex items-center gap-2"><input type="checkbox" checked={qualities.includes(quality)} onChange={(event) => setQualities((current) => event.target.checked ? [...current, quality] : current.filter((item) => item !== quality))} />{quality}</label>)}</fieldset>
        <AdvancedSettings>
          <TextField label="上游模型 ID" value={upstreamModel} onChange={setUpstreamModel} placeholder="默认与模型 ID 相同" />
          <TextField label="兼容模型 ID" value={aliases} onChange={setAliases} placeholder="多个值用逗号分隔" />
          <TextField label="优先级" value={priority} onChange={setPriority} inputMode="numeric" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-3">
            {(['512', '1K', '2K', '4K'] as ImageQuality[]).map((quality) => <TextField key={quality} label={`${quality} 专用模型`} value={qualityOverrides[quality] ?? ''} placeholder="沿用上游模型" onChange={(value) => setQualityOverrides((current) => {
              const next = { ...current };
              if (value.trim()) next[quality] = value.trim();
              else delete next[quality];
              return next;
            })} />)}
          </div>
          <div className="grid gap-3">
            <TextField label="失败回退模型" value={fallbackModels} onChange={setFallbackModels} placeholder="多个值用逗号分隔" />
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              启用模型
            </label>
          </div>
        </div>
        </AdvancedSettings>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <DialogActions pending={pending} onClose={onClose} />
      </form>
    </ConfigDialog>
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

function TextField({ label, value, onChange, placeholder, disabled, type = 'text', inputMode }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
      <select className="h-11 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
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

function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
