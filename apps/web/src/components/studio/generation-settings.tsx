'use client';

import { useState, type CSSProperties } from 'react';
import { Link2, Unlink2, Scan, X } from 'lucide-react';
import { aspectRatioOptions, customImageSize, resolutionOptions, supportsCustomImageSize, tokenRunSizeFor, type ImageQuality, type ModelConfig } from '@picup/shared';

type GenerationValues = { aspectRatio: string; quality: ImageQuality; count: number; width?: number; height?: number };
const ratioOrder = ['auto', '1:1', '3:4', '16:9', '4:3', '9:16', '2:3', '3:2', '21:9', '4:5', '5:4', '1:4', '4:1', '1:8', '8:1'];

export function GenerationSettings({ value, model, onChange, onClose, quoteLabel }: {
  value: GenerationValues; model?: ModelConfig; onChange: (patch: Partial<GenerationValues>) => void;
  onClose: () => void; quoteLabel: string;
}) {
  const ratios = aspectRatioOptions.filter(option => !model || model.supportedRatios.includes(option.value))
    .sort((a, b) => ratioOrder.indexOf(a.value) - ratioOrder.indexOf(b.value));
  const qualities = resolutionOptions.filter(option => !model || model.supportedQualities.includes(option.value));
  const editable = supportsCustomImageSize(model?.providerType, model?.model);
  let dimensions = ['', ''];
  if (model && ['openai-images', 'openai-compatible'].includes(model.providerType ?? '') && value.aspectRatio !== 'auto') {
    try { dimensions = tokenRunSizeFor(value.aspectRatio, value.quality).split('x'); } catch { /* Some models determine their own output size. */ }
  }
  if (value.width && value.height) dimensions = [String(value.width), String(value.height)];
  const dimensionKey = `${model?.provider}:${model?.model}:${value.aspectRatio}:${value.quality}:${value.width}:${value.height}`;
  const [locked, setLocked] = useState(true);
  const [editing, setEditing] = useState<{ key: string; values: string[] } | null>(null);
  const edited = editing?.key === dimensionKey;
  const inputs = edited ? editing.values : dimensions;
  let sizeError = '';
  if (editable && edited) {
    try {
      const size = customImageSize(Number(inputs[0]), Number(inputs[1]));
      if (model && !model.supportedQualities.includes(size.quality)) sizeError = `当前模型不支持此尺寸对应的 ${size.quality} 清晰度`;
    } catch (error) { sizeError = error instanceof Error ? error.message : '请输入有效宽高'; }
  }
  const changeDimension = (index: number, text: string) => {
    const next = [...inputs];
    next[index] = text;
    if (locked && Number(text) > 0) {
      const base = dimensions.every(Boolean) ? dimensions.map(Number) : [1024, 1024];
      next[1 - index] = String(Math.max(16, Math.round(Number(text) * base[1 - index] / base[index] / 16) * 16));
    }
    setEditing({ key: dimensionKey, values: next });
  };
  const commitDimensions = () => {
    if (!edited) return true;
    if (sizeError) return false;
    onChange(customImageSize(Number(inputs[0]), Number(inputs[1])));
    setEditing(null);
    return true;
  };
  const preset = (patch: Partial<GenerationValues>) => {
    setEditing(null);
    onChange({ ...patch, width: undefined, height: undefined });
  };
  const compactColumns = Math.ceil(ratios.length / Math.ceil(ratios.length / 5)) || 1;
  const columns = Math.ceil(ratios.length / Math.ceil(ratios.length / 11)) || 1;
  return <div className="generation-settings-body">
    <button type="button" className="studio-icon generation-settings-close" onClick={onClose} aria-label="关闭生成设置" title="关闭"><X size={18} /></button>
    <fieldset><legend>选择比例</legend>
      <div className="generation-segments generation-ratios" style={{ '--ratio-columns': columns, '--ratio-compact-columns': compactColumns } as CSSProperties}>
        {ratios.map(option => {
          const [width, height] = option.value.split(':').map(Number);
          return <button key={option.value} type="button" aria-pressed={value.aspectRatio === option.value} onClick={() => preset({ aspectRatio: option.value })}>
            <span className="generation-ratio-icon" aria-hidden="true">{option.value === 'auto' ? <Scan size={19} /> : <span className="ratio-symbol" style={{ width: 20 * Math.min(1, width / height), height: 20 * Math.min(1, height / width) }} />}</span>
            <span>{option.value === 'auto' ? '智能' : option.value}</span>
          </button>;
        })}
      </div>
    </fieldset>
    <fieldset><legend>选择分辨率</legend><div className="generation-segments">
      {qualities.map(option => <button key={option.value} type="button" aria-pressed={value.quality === option.value} onClick={() => preset({ quality: option.value, aspectRatio: ratios.some(ratio => ratio.value === value.aspectRatio) ? value.aspectRatio : 'auto' })}>{option.label}</button>)}
    </div></fieldset>
    <fieldset><legend>生成数量</legend><div className="generation-segments">
      {[1, 2, 3, 4].map(count => <button key={count} type="button" aria-label={`${count} 张`} aria-pressed={value.count === count} onClick={() => onChange({ count })}>{count}</button>)}
    </div></fieldset>
    <fieldset><legend>尺寸</legend><div className="generation-dimensions">
      <label className="generation-dimension"><span aria-hidden="true">W</span><input type="number" inputMode="numeric" min={16} max={3840} step={16} disabled={!editable} aria-label="输出宽度" aria-invalid={Boolean(sizeError)} aria-describedby="generation-size-note" placeholder="自动" value={inputs[0]} onChange={event => changeDimension(0, event.target.value)} onBlur={commitDimensions} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitDimensions(); } }} /></label>
      <button type="button" className="studio-icon generation-dimension-link" disabled={!editable} aria-label="锁定宽高比例" aria-pressed={locked} title={locked ? '解锁比例，分别设置宽高' : '锁定比例，联动调整宽高'} onClick={() => setLocked(!locked)}>{locked ? <Link2 size={20} /> : <Unlink2 size={20} />}</button>
      <label className="generation-dimension"><span aria-hidden="true">H</span><input type="number" inputMode="numeric" min={16} max={3840} step={16} disabled={!editable} aria-label="输出高度" aria-invalid={Boolean(sizeError)} aria-describedby="generation-size-note" placeholder="自动" value={inputs[1]} onChange={event => changeDimension(1, event.target.value)} onBlur={commitDimensions} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitDimensions(); } }} /></label>
      <span className="generation-dimension-unit">PX</span>
    </div><p id="generation-size-note" className={`generation-size-note ${sizeError ? 'studio-error' : ''}`} role={sizeError ? 'alert' : undefined}>{sizeError || (editable ? '宽高为 16 的倍数，最长边 3840px；清晰度随尺寸调整。' : '此模型按比例和清晰度生成；自定义像素请选择 GPT Image 2 / 2.5。')}</p></fieldset>
    <div className="size-options-footer"><span className="quote-label" aria-live="polite">{quoteLabel}</span><button className="studio-primary" type="button" disabled={Boolean(sizeError)} onClick={() => { if (commitDimensions()) onClose(); }}>完成</button></div>
  </div>;
}
