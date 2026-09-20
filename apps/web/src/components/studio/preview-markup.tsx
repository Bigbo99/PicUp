'use client';

import { useEffect, useId, useRef, useState, type RefObject, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Circle, MousePointer2, Paintbrush, Scan, Undo2, Redo2, Trash2, Eraser, Type, Square, Shapes, SlidersHorizontal, Check, X, Minus, ArrowUpRight, Triangle, Diamond, Star, Heart } from 'lucide-react';
import { usePreviewDraft } from './preview-draft';

const shapeOptions = [
  ['line', '直线标记', Minus], ['arrow', '箭头标记', ArrowUpRight],
  ['rectangle', '矩形标记', Square], ['mark', '圈选标记', Circle],
  ['triangle', '三角形标记', Triangle], ['diamond', '菱形标记', Diamond],
  ['star', '星形标记', Star], ['heart', '爱心标记', Heart],
] as const;
type ShapeTool = typeof shapeOptions[number][0];
const isShape = (tool: MarkupTool) => shapeOptions.some(([value]) => value === tool);
export type MarkupTool = ShapeTool | 'view' | 'select' | 'draw' | 'text' | 'mask' | 'erase' | 'comment';
type Point = { x: number; y: number };
type SelectionBox = Point & { width: number; height: number };
type Stroke = { tool: MarkupTool; points: Point[]; color: string; size: number; text?: string };
type History = { strokes: Stroke[]; undone: Stroke[]; past?: Stroke[][]; future?: Stroke[][] };
export type PreviewComment = Point & { text: string };

function ShapeMark({ stroke }: { stroke: Stroke }) {
  const first = stroke.points[0]; const last = stroke.points[stroke.points.length - 1];
  const x = Math.min(first.x, last.x); const y = Math.min(first.y, last.y);
  const width = Math.abs(last.x - first.x); const height = Math.abs(last.y - first.y);
  const paint = { fill: 'none', stroke: stroke.color, strokeWidth: stroke.size / 4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (stroke.tool === 'line' || stroke.tool === 'arrow') {
    const dx = last.x - first.x; const dy = last.y - first.y;
    const length = Math.hypot(dx, dy);
    const head = Math.min(length * .4, Math.max(18, stroke.size));
    const ux = length ? dx / length : 0; const uy = length ? dy / length : 0;
    return <path {...paint} d={`M ${first.x} ${first.y} L ${last.x} ${last.y}${stroke.tool === 'arrow' ? ` M ${last.x - head * ux - head * .5 * uy} ${last.y - head * uy + head * .5 * ux} L ${last.x} ${last.y} L ${last.x - head * ux + head * .5 * uy} ${last.y - head * uy - head * .5 * ux}` : ''}`} />;
  }
  if (stroke.tool === 'mark') return <ellipse {...paint} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} />;
  if (stroke.tool === 'rectangle') return <rect {...paint} x={x} y={y} width={width} height={height} />;
  if (stroke.tool === 'heart') return <path {...paint} d={`M ${x + width / 2} ${y + height} C ${x + width * .4} ${y + height * .8} ${x} ${y + height * .55} ${x} ${y + height * .28} C ${x} ${y - height * .08} ${x + width * .4} ${y - height * .08} ${x + width / 2} ${y + height * .2} C ${x + width * .6} ${y - height * .08} ${x + width} ${y - height * .08} ${x + width} ${y + height * .28} C ${x + width} ${y + height * .55} ${x + width * .6} ${y + height * .8} ${x + width / 2} ${y + height} Z`} />;
  const points = stroke.tool === 'triangle' ? [[.5, 0], [1, 1], [0, 1]]
    : stroke.tool === 'diamond' ? [[.5, 0], [1, .5], [.5, 1], [0, .5]]
    : Array.from({ length: 10 }, (_, i) => {
      const angle = i * Math.PI / 5 - Math.PI / 2; const radius = i % 2 ? .22 : .5;
      return [.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius];
    });
  return <polygon {...paint} points={points.map(([px, py]) => `${x + px * width},${y + py * height}`).join(' ')} />;
}

export function PreviewMarkup({ picture, toolbar, imageKey, transformKey, onActive, tool, onTool, comments, onComment, mode, disabled = false, activeComment, onSelectComment, onUpdateComment, onDeleteComment }: {
  picture: RefObject<HTMLImageElement | null>; toolbar: HTMLElement | null;
  imageKey: string; transformKey: string; onActive: (active: boolean) => void;
  tool: MarkupTool; onTool: (tool: MarkupTool) => void;
  comments: PreviewComment[]; onComment: (point: Point) => void;
  mode: string; disabled?: boolean; activeComment: number | null;
  onSelectComment: (index: number | null) => void; onUpdateComment: (index: number, text: string) => void; onDeleteComment: (index: number) => void;
}) {
  const id = useId().replace(/:/g, '');
  const [color, setColor] = useState('#f45d5d');
  const [size, setSize] = useState(20);
  const [panel, setPanel] = useState<'shapes' | 'settings' | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setPanel(null); }, [mode, imageKey, disabled]);
  useEffect(() => {
    if (!panel) return;
    const outside = (event: globalThis.PointerEvent) => { if (!toolsRef.current?.contains(event.target as Node)) setPanel(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      toolsRef.current?.querySelector<HTMLButtonElement>(`[data-panel="${panel}"]`)?.focus(); setPanel(null);
    };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [panel]);
  const [annotations, changeAnnotations] = usePreviewDraft<History>(`marks:${imageKey}`, { strokes: [], undone: [] });
  const [mask, changeMask] = usePreviewDraft<History>(`selection:${imageKey}`, { strokes: [], undone: [] });
  const state = mode === 'remove' ? mask : annotations;
  const save = mode === 'remove' ? changeMask : changeAnnotations;
  const change = (next: History) => save({ ...next, past: [...(state.past ?? []), state.strokes], future: [] });
  const undo = () => { setSelected([]); const past = state.past ?? []; if (past.length) save({ strokes: past[past.length - 1], undone: [], past: past.slice(0, -1), future: [state.strokes, ...(state.future ?? [])] }); };
  const redo = () => { setSelected([]); const future = state.future ?? []; if (future.length) save({ strokes: future[0], undone: [], past: [...(state.past ?? []), state.strokes], future: future.slice(1) }); };
  const overlay = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [selectionBoxes, setSelectionBoxes] = useState<SelectionBox[]>([]);
  const marquee = useRef<{ id: number; start: Point; previous: number[] } | null>(null);
  const [selectionArea, setSelectionArea] = useState<SelectionBox | null>(null);
  const moving = useRef<{ id: number; indices: number[]; start: Point; strokes: Stroke[] } | null>(null);
  const [movedStrokes, setMovedStrokes] = useState<Stroke[] | null>(null);
  useEffect(() => {
    if (!selected.length) { setSelectionBoxes(previous => previous.length ? [] : previous); return; }
    setSelectionBoxes(selected.flatMap(index => {
      const element = overlay.current?.querySelector<SVGGElement>(`[data-stroke-index="${index}"]`);
      if (!element) return [];
      const box = element.getBBox();
      return [{ x: box.x, y: box.y, width: box.width, height: box.height }];
    }));
  }, [selected, state.strokes, movedStrokes]);
  const [textDraft, setTextDraft] = useState<{ point: Point; text: string } | null>(null);
  const inlineText = useRef<HTMLInputElement>(null);
  const textPoint = textDraft?.point;
  useEffect(() => {
    if (!textPoint) return;
    const frame = requestAnimationFrame(() => inlineText.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [textPoint]);
  const [commentText, setCommentText] = useState('');
  const [cursor, setCursor] = useState<Point | null>(null);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const pending = useRef<{ id: number; stroke: Stroke } | null>(null);
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const image = picture.current;
    if (!image) return;
    const measure = () => {
      if (!image.isConnected || !image.parentElement) return;
      const rect = image.getBoundingClientRect();
      const parent = image.parentElement.getBoundingClientRect();
      setBounds({ left: rect.left - parent.left, top: rect.top - parent.top, width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(image); observer.observe(image.parentElement!);
    image.addEventListener('load', measure);
    return () => { observer.disconnect(); image.removeEventListener('load', measure); };
  }, [picture, imageKey, transformKey]);
  useEffect(() => { pending.current = null; moving.current = null; marquee.current = null; setSelectionArea(null); setSelected([]); setMovedStrokes(null); setDraft(null); setTextDraft(null); setCursor(null); }, [imageKey, tool, mode]);
  const activeText = activeComment === null ? '' : comments[activeComment]?.text ?? '';
  useEffect(() => { setCommentText(activeText); }, [activeComment, activeText, imageKey]);
  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1000, (event.clientX - rect.left) / rect.width * 1000)), y: Math.max(0, Math.min(1000 * bounds.height / bounds.width, (event.clientY - rect.top) / rect.width * 1000)) };
  }
  function append(event: PointerEvent<SVGSVGElement>) {
    const active = pending.current;
    if (!active || active.id !== event.pointerId) return;
    const next = point(event);
    active.stroke = { ...active.stroke, points: isShape(active.stroke.tool) ? [active.stroke.points[0], next] : [...active.stroke.points, next] };
    setDraft(active.stroke);
  }
  const strokes = ['annotate', 'remove'].includes(mode) ? [...(movedStrokes ?? state.strokes), ...(draft ? [draft] : [])] : [];
  function moveStroke(event: PointerEvent<SVGSVGElement>) {
    const active = moving.current;
    if (!active || active.id !== event.pointerId) return null;
    const next = point(event);
    const nextStrokes = active.strokes.map((stroke, index) => active.indices.includes(index) ? { ...stroke, points: stroke.points.map(p => ({ x: p.x + next.x - active.start.x, y: p.y + next.y - active.start.y })) } : stroke);
    setMovedStrokes(nextStrokes);
    return nextStrokes;
  }
  function selectArea(event: PointerEvent<SVGSVGElement>) {
    const active = marquee.current;
    if (!active || active.id !== event.pointerId) return;
    const end = point(event);
    const box = { x: Math.min(active.start.x, end.x), y: Math.min(active.start.y, end.y), width: Math.abs(end.x - active.start.x), height: Math.abs(end.y - active.start.y) };
    setSelectionArea(box);
    const indices: number[] = [];
    if (box.width > 2 && box.height > 2) overlay.current?.querySelectorAll<SVGGElement>('[data-stroke-index]').forEach(element => {
      const bounds = element.getBBox();
      if (bounds.x >= box.x && bounds.y >= box.y && bounds.x + bounds.width <= box.x + box.width && bounds.y + bounds.height <= box.y + box.height) indices.push(Number(element.dataset.strokeIndex));
    });
    setSelected([...new Set([...active.previous, ...indices])]);
  }
  function commitText() {
    if (!textDraft) return;
    if (textDraft.text.trim()) change({ strokes: [...state.strokes, { tool: 'text', points: [textDraft.point], text: textDraft.text.trim(), color, size: Math.max(18, size) * 1000 / bounds.width }], undone: [] });
    setTextDraft(null);
  }
  const height = bounds.width ? 1000 * bounds.height / bounds.width : 1000;
  const line = (stroke: Stroke, paint: string, width = stroke.size) => <polyline points={stroke.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={paint} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;
  const editorPoint = textDraft?.point ?? (activeComment !== null ? comments[activeComment] : undefined);
  const stageWidth = picture.current?.parentElement?.clientWidth ?? 320;
  const stageHeight = picture.current?.parentElement?.clientHeight ?? 300;
  const editorWidth = Math.min(420, stageWidth - 16);
  const pinX = bounds.left + (editorPoint?.x ?? 0) / 1000 * bounds.width;
  const pinY = bounds.top + (editorPoint?.y ?? 0) / 1000 * bounds.width;
  const beside = pinX + 24 + editorWidth <= stageWidth - 8 || pinX - 24 - editorWidth >= 8;
  const editorLeft = pinX + 24 + editorWidth <= stageWidth - 8 ? pinX + 24 : pinX - 24 - editorWidth >= 8 ? pinX - 24 - editorWidth : Math.max(8, Math.min(pinX - editorWidth / 2, stageWidth - editorWidth - 8));
  const editorTop = beside ? pinY - 26 : pinY + 24 + 54 <= stageHeight - 8 ? pinY + 24 : pinY - 78;
  function dismissEditor() {
    setTextDraft(null);
    if (activeComment !== null && !comments[activeComment]?.text.trim()) onDeleteComment(activeComment);
    else onSelectComment(null);
  }
  return <>
    {toolbar && ['annotate', 'remove'].includes(mode) && createPortal(<>
      <div ref={toolsRef} className="preview-markup-tools" role="toolbar" aria-label="预览编辑工具" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        {(mode === 'remove' ? [['select', '移动选区', MousePointer2], ['mask', '选取区域', Scan]] as const : [['select', '移动标记', MousePointer2], ['draw', '涂鸦', Paintbrush], ['text', '文字标记', Type]] as const).map(([value, label, Icon]) => <button key={value} title={label} aria-label={label} disabled={disabled} aria-pressed={tool === value} onClick={() => { setPanel(null); onTool(value); onActive(true); }}><Icon size={19} /></button>)}
        {mode === 'annotate' && <button data-panel="shapes" title="形状" aria-label="形状" aria-expanded={panel === 'shapes'} aria-controls={`${id}-shapes`} aria-pressed={isShape(tool)} disabled={disabled} onClick={() => setPanel(panel === 'shapes' ? null : 'shapes')}><Shapes size={19} /></button>}
        <button data-panel="settings" title="标记设置" aria-label="标记设置" aria-expanded={panel === 'settings'} aria-controls={`${id}-settings`} disabled={disabled} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>{mode === 'annotate' ? <span className="preview-current-color" style={{ backgroundColor: color }} /> : <SlidersHorizontal size={19} />}</button>
        <button title={mode === 'remove' ? '擦除选区' : '擦除标记'} aria-label={mode === 'remove' ? '擦除选区' : '擦除标记'} aria-pressed={tool === 'erase'} disabled={disabled} onClick={() => { setPanel(null); onTool('erase'); }}><Eraser size={19} /></button>
        <span className="preview-tool-divider" />
        <button title="撤销标记" aria-label="撤销标记" disabled={disabled || !state.past?.length} onClick={undo}><Undo2 size={19} /></button>
        <button className="preview-secondary-tool" title="重做标记" aria-label="重做标记" disabled={disabled || !state.future?.length} onClick={redo}><Redo2 size={19} /></button>
        {panel === 'shapes' && <div id={`${id}-shapes`} className="preview-tool-popover preview-shape-menu" role="group" aria-label="形状选项">
          {shapeOptions.map(([value, label, Icon]) => <button key={value} title={label} aria-label={label} aria-pressed={tool === value} onClick={() => { onTool(value); onActive(true); setPanel(null); toolsRef.current?.querySelector<HTMLButtonElement>('[data-panel="shapes"]')?.focus(); }}><Icon size={22} /></button>)}
        </div>}
        {panel === 'settings' && <div id={`${id}-settings`} className="preview-tool-popover preview-settings-menu" role="group" aria-label="标记设置选项">
          {mode === 'annotate' && <label className="preview-color-setting"><span>颜色</span><input type="color" className="preview-color-swatch" aria-label="标记颜色" title="标记颜色" value={color} onChange={event => setColor(event.target.value)} /></label>}
          <label className="preview-size-setting"><span>笔刷大小</span><output>{size}</output><input type="range" min="4" max="120" value={size} onChange={event => setSize(Number(event.target.value))} aria-label="笔刷大小" /></label>
          <div className="preview-settings-actions">
            <button className="preview-overflow-tool" title={mode === 'remove' ? '移动选区' : '移动标记'} aria-label={mode === 'remove' ? '移动选区' : '移动标记'} aria-pressed={tool === 'select'} onClick={() => { onTool('select'); setPanel(null); }}><MousePointer2 size={19} /></button>
            <button className="preview-overflow-tool" title="重做标记" aria-label="重做标记" disabled={!state.future?.length} onClick={redo}><Redo2 size={19} /></button>
            <button title="清除标记" aria-label="清除标记" disabled={!state.strokes.length} onClick={() => { change({ strokes: [], undone: [...state.strokes].reverse() }); setPanel(null); }}><Trash2 size={18} /></button>
          </div>
        </div>}
      </div>
    </>, toolbar)}
    {bounds.width > 0 && <svg ref={overlay} className="preview-markup-layer" style={{ ...bounds, pointerEvents: disabled || tool === 'view' ? 'none' : 'auto', cursor: tool === 'select' ? moving.current ? 'grabbing' : 'default' : tool === 'text' ? 'text' : undefined }} viewBox={`0 0 1000 ${height}`} aria-label="图片标记层"
      onClick={event => {
        event.stopPropagation();
        if (tool !== 'text') return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        commitText();
        setTextDraft({ point: { x: Math.max(0, Math.min(1000, (event.clientX - rect.left) / rect.width * 1000)), y: Math.max(0, Math.min(height, (event.clientY - rect.top) / rect.width * 1000)) }, text: '' });
      }}
      onPointerDown={event => {
        event.stopPropagation(); if (disabled || event.button !== 0 || pending.current || moving.current || marquee.current) return;
        const start = point(event);
        if (tool === 'select') {
          event.preventDefault();
          const target = (event.target as Element).closest('[data-stroke-index]');
          if (!target) {
            marquee.current = { id: event.pointerId, start, previous: event.shiftKey ? selected : [] };
            setSelected(marquee.current.previous);
            setSelectionArea({ ...start, width: 0, height: 0 });
            event.currentTarget.setPointerCapture(event.pointerId); return;
          }
          const index = Number(target.getAttribute('data-stroke-index'));
          const indices = event.shiftKey ? selected.includes(index) ? selected.filter(value => value !== index) : [...selected, index] : selected.includes(index) ? selected : [index];
          setSelected(indices);
          if (!indices.includes(index)) return;
          moving.current = { id: event.pointerId, indices, start, strokes: state.strokes };
          event.currentTarget.setPointerCapture(event.pointerId); return;
        }
        if (tool === 'comment') { onComment(start); return; }
        if (tool === 'text') { event.preventDefault(); return; }
        event.currentTarget.setPointerCapture(event.pointerId);
        const stroke = { tool, color, size: size * 1000 / bounds.width, points: [start, start] };
        pending.current = { id: event.pointerId, stroke }; setDraft(stroke);
      }}
      onPointerMove={event => { event.stopPropagation(); setCursor(point(event)); if (marquee.current) selectArea(event); else if (moving.current) moveStroke(event); else append(event); }}
      onPointerLeave={() => setCursor(null)}
      onPointerUp={event => {
        event.stopPropagation();
        if (marquee.current?.id === event.pointerId) {
          selectArea(event); marquee.current = null; setSelectionArea(null); return;
        }
        if (moving.current?.id === event.pointerId) {
          const active = moving.current; const next = moveStroke(event);
          const end = point(event);
          if (next && (end.x !== active.start.x || end.y !== active.start.y)) change({ strokes: next, undone: [] });
          moving.current = null; setMovedStrokes(null); return;
        }
        if (pending.current?.id !== event.pointerId) return;
        append(event); change({ strokes: [...state.strokes, pending.current.stroke], undone: [] }); pending.current = null; setDraft(null);
      }}
      onPointerCancel={event => { event.stopPropagation(); marquee.current = null; setSelectionArea(null); moving.current = null; setMovedStrokes(null); pending.current = null; setDraft(null); }}>
      <defs>{strokes.map((stroke, index) => stroke.tool !== 'erase' && <mask key={index} id={`${id}-${index}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height={height}>
        <rect width="1000" height={height} fill="white" />
        {strokes.slice(index + 1).map((later, i) => later.tool === 'erase' ? <g key={i}>{line(later, 'black')}</g> : null)}
      </mask>)}</defs>
      {(['mask', 'annotation'] as const).map(layer => <g key={layer} data-layer={layer} opacity={layer === 'mask' ? .45 : 1}>
        {strokes.map((stroke, index) => {
          if (stroke.tool === 'erase' || (layer === 'mask') !== (stroke.tool === 'mask')) return null;
          const first = stroke.points[0];
          return <g key={index} data-stroke-index={index} style={{ cursor: tool === 'select' ? 'grab' : undefined }} mask={`url(#${id}-${index})`}>{isShape(stroke.tool) ? <ShapeMark stroke={stroke} /> : stroke.tool === 'text' ? <text x={first.x} y={first.y} fill={stroke.color} fontSize={stroke.size} fontFamily="sans-serif" dominantBaseline="hanging">{stroke.text}</text> : line(stroke, stroke.tool === 'mask' ? '#60a5fa' : stroke.color, stroke.tool === 'mask' ? stroke.size : stroke.size / 4)}</g>;
        })}
      </g>)}
      <g data-layer="comments">{mode === 'comment' && comments.map((comment, index) => <g key={index}><circle cx={comment.x} cy={comment.y} r="18" fill="#202526" stroke="white" strokeWidth="2" /><text x={comment.x} y={comment.y} dy="6" textAnchor="middle" fill="white" fontSize="18" fontFamily="sans-serif">{index + 1}</text></g>)}</g>
      {tool === 'select' && <g data-editor-ui="selection" pointerEvents="none" fill="none" stroke="#347af0" strokeWidth={1.5 * 1000 / bounds.width}>
        {selectionBoxes.map((box, index) => <rect key={index} data-selected-mark="true" x={box.x - 3} y={box.y - 3} width={box.width + 6} height={box.height + 6} strokeDasharray={`${4 * 1000 / bounds.width} ${3 * 1000 / bounds.width}`} />)}
        {selectionArea && <rect data-selection-marquee="true" {...selectionArea} fill="#347af018" />}
      </g>}
      {cursor && ['mask', 'erase'].includes(tool) && <circle data-editor-ui="cursor" cx={cursor.x} cy={cursor.y} r={size * 500 / bounds.width} fill="none" stroke="white" strokeWidth={1.5 * 1000 / bounds.width} style={{ pointerEvents: 'none' }} />}
    </svg>}
    {mode === 'comment' && comments.map((comment, index) => <button key={index} className="preview-comment-pin" style={{ left: bounds.left + comment.x / 1000 * bounds.width, top: bounds.top + comment.y / 1000 * bounds.width }} aria-label={`编辑评论 ${index + 1}`} aria-pressed={activeComment === index} disabled={disabled} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelectComment(index); }}>{index + 1}</button>)}
    {textDraft && <input ref={inlineText} className="preview-inline-text" aria-label="标记文字" maxLength={80} disabled={disabled} style={{ left: pinX, top: pinY, width: Math.max(24, Math.min(stageWidth - pinX - 4, (textDraft.text.length + 1) * Math.max(18, size))), fontSize: Math.max(18, size), color }} value={textDraft.text} onChange={event => setTextDraft({ ...textDraft, text: event.target.value })} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onBlur={() => { if (textDraft.text.trim()) commitText(); }} onKeyDown={event => { event.stopPropagation(); if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); commitText(); } if (event.key === 'Escape') { event.preventDefault(); setTextDraft(null); } }} />}
    {(mode === 'comment' && activeComment !== null && comments[activeComment]) && <form className="preview-point-editor" style={{ left: editorLeft, top: Math.max(8, Math.min(editorTop, stageHeight - 62)), width: editorWidth }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onSubmit={event => {
      event.preventDefault();
      if (!commentText.trim()) return;
      onUpdateComment(activeComment!, commentText.trim());
    }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissEditor(); } }}>
      <input key={activeComment} autoFocus aria-label={`评论 ${activeComment! + 1}`} placeholder="描述此处的修改" maxLength={200} disabled={disabled} value={commentText} onChange={event => setCommentText(event.target.value)} />
      <button className="preview-point-confirm" type="submit" title="完成输入" aria-label="完成输入" disabled={disabled || !commentText.trim()}><Check size={18} /></button>
      {Boolean(comments[activeComment!]?.text.trim()) && <button type="button" title="删除评论" aria-label={`删除评论 ${activeComment! + 1}`} disabled={disabled} onClick={() => onDeleteComment(activeComment!)}><Trash2 size={16} /></button>}
      <span className="preview-tool-divider" /><button type="button" title="关闭输入" aria-label="关闭输入" disabled={disabled} onClick={dismissEditor}><X size={16} /></button>
    </form>}
  </>;
}
