'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
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
  updateAdminAiMock,
  updateAdminAiModel,
  updateAdminAiProvider,
  updateAdminAiRouting
} from '@/lib/admin-api';
import { useNotifications } from '@/components/notification-provider';

type ProviderEditorState = { provider?: AdminAiProviderConfig } | null;
type ModelEditorState = { providerId: string; model?: AdminAiModelConfig } | null;

const providerTypeLabels: Record<AiProviderType, string> = {
  grsai: 'GrsAI',
  'gemini-official': 'Gemini Official',
  'openai-images': 'OpenAI Images 兼容'
};

export function AiConfigPanel() {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [providerEditor, setProviderEditor] = useState<ProviderEditorState>(null);
  const [modelEditor, setModelEditor] = useState<ModelEditorState>(null);
  const configQuery = useQuery({ queryKey: ['admin', 'ai-config'], queryFn: getAdminAiConfig });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'ai-config'] });
    await queryClient.invalidateQueries({ queryKey: ['models'] });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'provider-health'] });
  };

  const providerMutation = useMutation({
    mutationFn: async ({ providerId, input }: { providerId?: string; input: AdminAiProviderInput }) => providerId
      ? updateAdminAiProvider(providerId, input)
      : createAdminAiProvider(input),
    onSuccess: async () => {
      setProviderEditor(null);
      await refresh();
      notifications.success('Provider 配置已保存');
    },
    onError: (error) => notifications.error('Provider 保存失败', error instanceof Error ? error.message : '请检查配置')
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
    onError: (error) => notifications.error('Provider 更新失败', error instanceof Error ? error.message : '请稍后重试')
  });

  const quickModelMutation = useMutation({
    mutationFn: ({ providerId, modelId, patch }: { providerId: string; modelId: string; patch: Partial<AdminAiModelInput> }) => updateAdminAiModel(providerId, modelId, patch),
    onSuccess: refresh,
    onError: (error) => notifications.error('模型更新失败', error instanceof Error ? error.message : '请稍后重试')
  });

  if (configQuery.isLoading) {
    return <div className="flex min-h-48 items-center justify-center text-slate-500"><Loader2 className="animate-spin" size={24} /></div>;
  }
  if (configQuery.error || !configQuery.data) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{configQuery.error instanceof Error ? configQuery.error.message : 'AI 配置加载失败'}</div>;
  }

  const config = configQuery.data;

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-emerald-950/10 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-black text-[#083b2d]">AI Provider 配置</h3>
            <p className="mt-1 break-all text-xs text-slate-500">运行时文件：{config.path}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`admin-secondary-button ${config.mockEnabled ? 'border-amber-300 bg-amber-50 text-amber-800' : ''}`}
              onClick={() => updateAdminAiMock(!config.mockEnabled).then(refresh).catch((error) => notifications.error('Mock 设置失败', error instanceof Error ? error.message : '请稍后重试'))}
            >
              Mock {config.mockEnabled ? '已启用' : '已关闭'}
            </button>
            <button type="button" className="admin-primary-button" onClick={() => setProviderEditor({})}>
              <Plus size={16} aria-hidden />
              新增 Provider
            </button>
          </div>
        </div>

        <RoutingControls config={config} onSaved={refresh} />
      </section>

      {config.providers.map((provider) => (
        <section key={provider.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <header className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-black text-[#083b2d]">{provider.displayName}</h3>
                <ConfigBadge label={providerTypeLabels[provider.type]} tone="info" />
                <ConfigBadge label={provider.enabled ? '已启用' : '已禁用'} tone={provider.enabled ? 'success' : 'danger'} />
                <ConfigBadge label={provider.apiKeyConfigured ? '密钥已配置' : '密钥未配置'} tone={provider.apiKeyConfigured ? 'success' : 'warning'} />
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-600">{provider.id} · {provider.baseUrl}</p>
              <p className="mt-1 text-xs text-slate-500">默认模型：{provider.defaultModel || '未设置'} · 请求路径：{Object.values(provider.paths).filter(Boolean).join(' / ') || '未设置'}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" className="admin-secondary-button" onClick={() => setModelEditor({ providerId: provider.id })}>
                <Plus size={15} aria-hidden />
                添加模型
              </button>
              <button type="button" className="admin-secondary-button" onClick={() => setProviderEditor({ provider })}>
                <Pencil size={15} aria-hidden />
                编辑连接
              </button>
              <button
                type="button"
                className="admin-secondary-button"
                onClick={() => quickProviderMutation.mutate({ providerId: provider.id, patch: { enabled: !provider.enabled } })}
              >
                {provider.enabled ? '停用' : '启用'}
              </button>
              {provider.apiKeyConfigured && (
                <button
                  type="button"
                  className="admin-icon-button"
                  aria-label={`清除 ${provider.displayName} API Key`}
                  title="清除 API Key"
                  onClick={async () => {
                    const confirmed = await notifications.confirm({
                      title: `清除 ${provider.displayName} API Key？`,
                      message: '清除后该 Provider 将无法进行真实模型调用，重新填写密钥后可恢复。',
                      confirmText: '清除',
                      cancelText: '取消',
                      tone: 'danger'
                    });
                    if (confirmed) quickProviderMutation.mutate({ providerId: provider.id, patch: { clearApiKey: true } });
                  }}
                >
                  <KeyRound size={15} aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="admin-icon-button border-red-200 text-red-600 hover:border-red-400 hover:text-red-700"
                aria-label={`删除 ${provider.displayName}`}
                title="删除 Provider"
                onClick={async () => {
                  const confirmed = await notifications.confirm({
                    title: `删除 ${provider.displayName}？`,
                    message: 'Provider 及其模型会从 ai-config 中移除。默认路由正在使用时不能删除。',
                    confirmText: '删除',
                    cancelText: '取消',
                    tone: 'danger'
                  });
                  if (!confirmed) return;
                  try {
                    await deleteAdminAiProvider(provider.id);
                    await refresh();
                    notifications.success('Provider 已删除');
                  } catch (error) {
                    notifications.error('删除失败', error instanceof Error ? error.message : '请稍后重试');
                  }
                }}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </div>
          </header>

          {provider.models.length === 0 ? (
            <div className="p-6 text-center text-sm font-semibold text-slate-500">该 Provider 尚未配置模型。</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {provider.models.map((model) => (
                <div key={model.model} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-black text-slate-900">{model.displayName}</h4>
                      <ConfigBadge label={model.enabled ? '已启用' : '已禁用'} tone={model.enabled ? 'success' : 'danger'} />
                    </div>
                    <p className="mt-1 break-all text-xs font-semibold text-slate-500">{model.model}{model.upstreamModel && model.upstreamModel !== model.model ? ` → ${model.upstreamModel}` : ''}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{model.description}</p>
                    <p className="mt-2 text-xs text-slate-500">比例 {model.supportedRatios.join(', ')} · 清晰度 {model.supportedQualities.join(', ')}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <InlineNumberField label="优先级" value={model.priority ?? 100} onSave={(priority) => quickModelMutation.mutate({ providerId: provider.id, modelId: model.model, patch: { priority } })} />
                    <InlineNumberField label="积分" value={model.costCredits} onSave={(costCredits) => quickModelMutation.mutate({ providerId: provider.id, modelId: model.model, patch: { costCredits } })} />
                    <InlineNumberField label="参考图上限" value={model.maxInputImages} onSave={(maxInputImages) => quickModelMutation.mutate({ providerId: provider.id, modelId: model.model, patch: { maxInputImages } })} />
                    <div className="grid content-end grid-cols-3 gap-1">
                      <button type="button" className="admin-icon-button" title="编辑模型" aria-label="编辑模型" onClick={() => setModelEditor({ providerId: provider.id, model })}><Pencil size={15} /></button>
                      <button type="button" className="admin-icon-button" title={model.enabled ? '停用模型' : '启用模型'} aria-label={model.enabled ? '停用模型' : '启用模型'} onClick={() => quickModelMutation.mutate({ providerId: provider.id, modelId: model.model, patch: { enabled: !model.enabled } })}><KeyRound size={15} /></button>
                      <button
                        type="button"
                        className="admin-icon-button border-red-200 text-red-600 hover:border-red-400 hover:text-red-700"
                        title="删除模型"
                        aria-label="删除模型"
                        onClick={async () => {
                          const confirmed = await notifications.confirm({ title: `删除 ${model.displayName}？`, message: '默认路由正在使用时不能删除。', confirmText: '删除', cancelText: '取消', tone: 'danger' });
                          if (!confirmed) return;
                          try {
                            await deleteAdminAiModel(provider.id, model.model);
                            await refresh();
                            notifications.success('模型已删除');
                          } catch (error) {
                            notifications.error('删除失败', error instanceof Error ? error.message : '请稍后重试');
                          }
                        }}
                      ><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      {providerEditor && (
        <ProviderEditorDialog
          key={providerEditor.provider?.id ?? 'new-provider'}
          provider={providerEditor.provider}
          pending={providerMutation.isPending}
          onClose={() => setProviderEditor(null)}
          onSave={(input) => providerMutation.mutate({ providerId: providerEditor.provider?.id, input })}
        />
      )}
      {modelEditor && (
        <ModelEditorDialog
          key={`${modelEditor.providerId}:${modelEditor.model?.model ?? 'new-model'}`}
          providerId={modelEditor.providerId}
          model={modelEditor.model}
          pending={modelMutation.isPending}
          onClose={() => setModelEditor(null)}
          onSave={(input) => modelMutation.mutate({ providerId: modelEditor.providerId, modelId: modelEditor.model?.model, input })}
        />
      )}
    </div>
  );
}

function RoutingControls({ config, onSaved }: { config: AdminAiConfigResponse; onSaved: () => Promise<void> }) {
  const notifications = useNotifications();
  const options = config.providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({
    value: `${provider.id}:${model.model}`,
    label: `${provider.displayName} / ${model.displayName}`
  })));
  const [defaultTarget, setDefaultTarget] = useState(`${config.routing.default.provider}:${config.routing.default.model}`);
  const [professionalTarget, setProfessionalTarget] = useState(`${config.routing.professional.provider}:${config.routing.professional.model}`);
  const [pending, setPending] = useState(false);

  return (
    <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
      <ConfigSelect label="默认自动路由" value={defaultTarget} options={options} onChange={setDefaultTarget} />
      <ConfigSelect label="专业任务路由" value={professionalTarget} options={options} onChange={setProfessionalTarget} />
      <button
        type="button"
        className="admin-primary-button"
        disabled={pending}
        onClick={async () => {
          const [defaultProvider, ...defaultModelParts] = defaultTarget.split(':');
          const [professionalProvider, ...professionalModelParts] = professionalTarget.split(':');
          setPending(true);
          try {
            await updateAdminAiRouting({
              default: { provider: defaultProvider, model: defaultModelParts.join(':') },
              professional: { provider: professionalProvider, model: professionalModelParts.join(':') }
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
        保存路由
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
  const [type, setType] = useState<AiProviderType>(provider?.type ?? 'grsai');
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '');
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [paths, setPaths] = useState(JSON.stringify(provider?.paths ?? { generate: '/v1/draw/nano-banana', result: '/v1/draw/result' }, null, 2));
  const [defaultModel, setDefaultModel] = useState(provider?.defaultModel ?? '');
  const [aliases, setAliases] = useState((provider?.aliases ?? []).join(', '));
  const [timeoutMs, setTimeoutMs] = useState(String(provider?.timeoutMs ?? 600000));
  const [error, setError] = useState('');

  return (
    <ConfigDialog title={provider ? `编辑 ${provider.displayName}` : '新增 Provider'} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsedPaths = JSON.parse(paths) as AdminAiProviderInput['paths'];
          const timeout = Number(timeoutMs);
          if (!id.trim() || !displayName.trim() || !baseUrl.trim() || !Number.isInteger(timeout)) throw new Error('请完整填写 Provider 信息');
          onSave({
            id: id.trim(),
            type,
            displayName: displayName.trim(),
            enabled,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            baseUrl: baseUrl.trim(),
            paths: parsedPaths,
            defaultModel: defaultModel.trim(),
            aliases: splitList(aliases),
            timeoutMs: timeout
          });
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : '配置格式错误');
        }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Provider ID" value={id} onChange={setId} disabled={Boolean(provider)} placeholder="example-provider" />
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            适配器类型
            <select className="h-11 rounded-lg border border-slate-200 bg-white px-3" value={type} onChange={(event) => setType(event.target.value as AiProviderType)}>
              {Object.entries(providerTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <TextField label="显示名称" value={displayName} onChange={setDisplayName} placeholder="Provider 名称" />
          <TextField label="默认模型 ID" value={defaultModel} onChange={setDefaultModel} placeholder="可在添加模型后设置" />
        </div>
        <TextField label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com" />
        <TextField label={provider?.apiKeyConfigured ? 'API Key（留空保持原值）' : 'API Key'} value={apiKey} onChange={setApiKey} type="password" placeholder="不会返回已保存的密钥" />
        <TextField label="兼容 Provider ID" value={aliases} onChange={setAliases} placeholder="多个值用逗号分隔" />
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          请求路径 JSON
          <textarea className="min-h-28 rounded-lg border border-slate-200 p-3 font-mono text-sm" value={paths} onChange={(event) => setPaths(event.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="超时毫秒" value={timeoutMs} onChange={setTimeoutMs} inputMode="numeric" />
          <label className="flex min-h-11 items-center gap-2 self-end rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            启用 Provider
          </label>
        </div>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <DialogActions pending={pending} onClose={onClose} />
      </form>
    </ConfigDialog>
  );
}

function ModelEditorDialog({ providerId, model, pending, onClose, onSave }: {
  providerId: string;
  model?: AdminAiModelConfig;
  pending: boolean;
  onClose: () => void;
  onSave: (input: AdminAiModelInput) => void;
}) {
  const [modelId, setModelId] = useState(model?.model ?? '');
  const [upstreamModel, setUpstreamModel] = useState(model?.upstreamModel ?? '');
  const [displayName, setDisplayName] = useState(model?.displayName ?? '');
  const [description, setDescription] = useState(model?.description ?? '');
  const [enabled, setEnabled] = useState(model?.enabled ?? true);
  const [priority, setPriority] = useState(String(model?.priority ?? 100));
  const [maxInputImages, setMaxInputImages] = useState(String(model?.maxInputImages ?? 4));
  const [costCredits, setCostCredits] = useState(String(model?.costCredits ?? 1));
  const [aliases, setAliases] = useState((model?.aliases ?? []).join(', '));
  const [ratios, setRatios] = useState((model?.supportedRatios ?? ['auto', '1:1', '16:9', '9:16']).join(', '));
  const [qualities, setQualities] = useState((model?.supportedQualities ?? ['1K', '2K']).join(', '));
  const [qualityOverrides, setQualityOverrides] = useState(JSON.stringify(model?.qualityModelOverrides ?? {}, null, 2));
  const [fallbackModels, setFallbackModels] = useState((model?.fallbackModels ?? []).join(', '));
  const [error, setError] = useState('');

  return (
    <ConfigDialog title={model ? `编辑 ${model.displayName}` : `为 ${providerId} 添加模型`} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsedQualities = splitList(qualities) as ImageQuality[];
          const allowed = new Set<ImageQuality>(['512', '1K', '2K', '4K']);
          if (parsedQualities.some((quality) => !allowed.has(quality))) throw new Error('清晰度仅支持 512、1K、2K、4K');
          const next: AdminAiModelInput = {
            model: modelId.trim(),
            upstreamModel: upstreamModel.trim() || undefined,
            aliases: splitList(aliases),
            displayName: displayName.trim(),
            description: description.trim(),
            enabled,
            priority: Number(priority),
            maxInputImages: Number(maxInputImages),
            supportedRatios: splitList(ratios),
            supportedQualities: parsedQualities,
            costCredits: Number(costCredits),
            qualityModelOverrides: JSON.parse(qualityOverrides || '{}') as AdminAiModelInput['qualityModelOverrides'],
            fallbackModels: splitList(fallbackModels)
          };
          if (!next.model || !next.displayName || !Number.isInteger(next.priority) || !Number.isInteger(next.maxInputImages) || !Number.isInteger(next.costCredits)) {
            throw new Error('请完整填写模型信息');
          }
          onSave(next);
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : '配置格式错误');
        }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="模型 ID" value={modelId} onChange={setModelId} disabled={Boolean(model)} placeholder="model-id" />
          <TextField label="上游模型 ID" value={upstreamModel} onChange={setUpstreamModel} placeholder="默认与模型 ID 相同" />
          <TextField label="显示名称" value={displayName} onChange={setDisplayName} placeholder="模型名称" />
          <TextField label="兼容模型 ID" value={aliases} onChange={setAliases} placeholder="多个值用逗号分隔" />
        </div>
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          模型说明
          <textarea className="min-h-20 rounded-lg border border-slate-200 p-3 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <TextField label="优先级" value={priority} onChange={setPriority} inputMode="numeric" />
          <TextField label="参考图上限" value={maxInputImages} onChange={setMaxInputImages} inputMode="numeric" />
          <TextField label="积分" value={costCredits} onChange={setCostCredits} inputMode="numeric" />
        </div>
        <TextField label="支持比例" value={ratios} onChange={setRatios} placeholder="auto, 1:1, 16:9" />
        <TextField label="支持清晰度" value={qualities} onChange={setQualities} placeholder="1K, 2K, 4K" />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-bold text-slate-700">
            清晰度模型覆盖 JSON
            <textarea className="min-h-24 rounded-lg border border-slate-200 p-3 font-mono text-sm" value={qualityOverrides} onChange={(event) => setQualityOverrides(event.target.value)} />
          </label>
          <div className="grid gap-3">
            <TextField label="失败回退模型" value={fallbackModels} onChange={setFallbackModels} placeholder="多个值用逗号分隔" />
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              启用模型
            </label>
          </div>
        </div>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <DialogActions pending={pending} onClose={onClose} />
      </form>
    </ConfigDialog>
  );
}

function ConfigDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label="关闭" onClick={onClose} />
      <section className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
        <header className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-[#083b2d]">{title}</h2>
          <button type="button" className="admin-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
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
        type={type}
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

function InlineNumberField({ label, value, onSave }: { label: string; value: number; onSave: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <label className="grid gap-1 text-xs font-bold text-slate-500">
      {label}
      <span className="flex gap-1">
        <input className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-sm font-bold" value={draft} onChange={(event) => setDraft(event.target.value)} inputMode="numeric" />
        <button type="button" className="admin-icon-button" onClick={() => {
          const next = Number(draft);
          if (Number.isInteger(next) && next >= 0) onSave(next);
        }} aria-label={`保存${label}`} title={`保存${label}`}><Save size={14} /></button>
      </span>
    </label>
  );
}

function ConfigBadge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'info' }) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    danger: 'border-red-200 bg-red-50 text-red-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700'
  }[tone];
  return <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-black ${styles}`}>{label}</span>;
}

function splitList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
