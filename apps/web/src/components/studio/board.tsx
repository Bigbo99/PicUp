'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowUpRight, Check, Circle, Diamond, Eraser, Heart, Minus, Paintbrush,
  RotateCcw, RotateCw, Square, Star, Triangle, Type, X,
} from 'lucide-react';
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  Tldraw,
  createShapeId,
  exportToBlob,
  type Editor,
  type TLDrawShape,
  type TLDrawShapeSegment,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
  type TLShapeId,
} from 'tldraw';
import 'tldraw/tldraw.css';

type BoardProps = {
  onClose: () => void;
  onSave?: (file: File) => void | Promise<void>;
  initialImageUrl?: string;
};

const COLORS: Array<{ value: TLDefaultColorStyle; swatch: string; label: string }> = [
  { value: 'black', swatch: '#1f2933', label: '黑色' },
  { value: 'grey', swatch: '#94a3b8', label: '灰色' },
  { value: 'orange', swatch: '#f97316', label: '橙色' },
  { value: 'red', swatch: '#ef4444', label: '红色' },
  { value: 'yellow', swatch: '#facc15', label: '黄色' },
  { value: 'green', swatch: '#22c55e', label: '绿色' },
  { value: 'light-blue', swatch: '#38bdf8', label: '浅蓝色' },
  { value: 'blue', swatch: '#3b82f6', label: '蓝色' },
  { value: 'violet', swatch: '#a855f7', label: '紫色' },
];

const SHAPES = [
  ['line', '直线', Minus], ['arrow', '箭头', ArrowUpRight], ['rectangle', '矩形', Square], ['ellipse', '圆形', Circle],
  ['triangle', '三角形', Triangle], ['diamond', '菱形', Diamond], ['star', '星形', Star], ['heart', '心形', Heart],
] as const;

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function hexToRgb(hex: string): RGB {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) || 0,
    g: Number.parseInt(normalized.slice(2, 4), 16) || 0,
    b: Number.parseInt(normalized.slice(4, 6), 16) || 0,
  };
}

function rgbToHex({ r, g, b }: RGB) {
  return `#${[r, g, b].map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function hexToHsl(hex: string): HSL {
  const { r: red, g: green, b: blue } = hexToRgb(hex);
  const r = red / 255; const g = green / 255; const b = blue / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: h < 0 ? h + 360 : h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number) {
  const saturation = clamp(s, 0, 100) / 100; const lightness = clamp(l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1)); const m = lightness - chroma / 2;
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

const BRUSH_SIZE_MIN = 2;
const BRUSH_SIZE_MAX = 20;
const BRUSH_SIZE_STEP = 0.1;
const DEFAULT_BRUSH_SIZE = 5.5;
const ERASER_SIZE_MIN = 12;
const ERASER_SIZE_MAX = 56;
const ERASER_SIZE_STEP = 0.5;
const DEFAULT_ERASER_SIZE = 28;

type Point = { x: number; y: number };

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function distanceToPolyline(point: Point, path: Point[]) {
  if (path.length < 2) return path[0] ? distanceToSegment(point, path[0], path[0]) : Number.POSITIVE_INFINITY;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.length - 1; index += 1) distance = Math.min(distance, distanceToSegment(point, path[index], path[index + 1]));
  return distance;
}

function splitDrawPointsForErase(shape: TLDrawShape, eraserPath: Point[], radius: number) {
  const points = shape.props.segments.flatMap(segment => segment.points);
  if (!points.length) return { touched: false, runs: [] as TLDrawShapeSegment['points'][] };

  const erased = points.map(point => distanceToPolyline(point, eraserPath) <= radius);
  const runs: TLDrawShapeSegment['points'][] = [];
  let currentRun: TLDrawShapeSegment['points'] = [];
  points.forEach((point, index) => {
    if (erased[index]) {
      if (currentRun.length) runs.push(currentRun);
      currentRun = [];
      return;
    }
    currentRun.push(point);
  });
  if (currentRun.length) runs.push(currentRun);

  const filteredRuns = runs.filter(run => run.length > 1 || points.length === 1);
  return { touched: erased.some(Boolean), runs: filteredRuns };
}

function toTldrawSize(value: number): TLDefaultSizeStyle {
  if (value <= 3) return 's';
  if (value <= 6) return 'm';
  if (value <= 11) return 'l';
  return 'xl';
}

function paletteColorForCustomColor(hex: string): TLDefaultColorStyle {
  const { h, s, l } = hexToHsl(hex);
  if (s < 12) return l < 28 ? 'black' : l > 88 ? 'white' : 'grey';
  if (h < 18 || h >= 330) return l > 76 ? 'light-red' : 'red';
  if (h < 48) return 'orange';
  if (h < 72) return 'yellow';
  if (h < 168) return l > 76 ? 'light-green' : 'green';
  if (h < 205) return 'light-blue';
  if (h < 255) return 'blue';
  return l > 76 ? 'light-violet' : 'violet';
}

export function Board({ onClose, onSave, initialImageUrl }: BoardProps) {
  const editorRef = useRef<Editor | null>(null);
  const initializedEditors = useRef(new WeakSet<Editor>());
  const brushCursorRef = useRef<HTMLSpanElement | null>(null);
  const [tool, setTool] = useState('draw');
  const [color, setColor] = useState<TLDefaultColorStyle>('black');
  const [customColor, setCustomColor] = useState('#ef4444');
  const [customColorActive, setCustomColorActive] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [eraserSize, setEraserSize] = useState(DEFAULT_ERASER_SIZE);
  const [shapeMenu, setShapeMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eraserGestureRef = useRef<{ pointerId: number; path: Point[]; processed: Point } | null>(null);
  const eraserFrameRef = useRef<number | null>(null);

  const selectedColor = customColorActive ? customColor : COLORS.find(item => item.value === color)?.swatch ?? '#1f2933';
  const customRgb = hexToRgb(customColor);
  const customHsl = hexToHsl(customColor);
  const isEraserMode = tool === 'eraser';
  const activeSize = isEraserMode ? eraserSize : brushSize;
  const activeSizeMin = isEraserMode ? ERASER_SIZE_MIN : BRUSH_SIZE_MIN;
  const activeSizeMax = isEraserMode ? ERASER_SIZE_MAX : BRUSH_SIZE_MAX;
  const activeSizeStep = isEraserMode ? ERASER_SIZE_STEP : BRUSH_SIZE_STEP;
  const activeSizeLabel = Number.isInteger(activeSize) ? `${activeSize}` : activeSize.toFixed(1);
  const sizeProgress = ((activeSize - activeSizeMin) / (activeSizeMax - activeSizeMin)) * 100;
  const brushCursorStyle = {
    '--board-brush-size': `${activeSize}px`,
    '--board-brush-color': selectedColor,
  } as CSSProperties;

  const updateBrushCursor = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((tool !== 'draw' && tool !== 'eraser') || !brushCursorRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursor = brushCursorRef.current;
    cursor.style.left = `${event.clientX - bounds.left}px`;
    cursor.style.top = `${event.clientY - bounds.top}px`;
    cursor.style.opacity = '1';
  }, [tool]);

  const hideBrushCursor = useCallback(() => {
    if (brushCursorRef.current) brushCursorRef.current.style.opacity = '0';
  }, []);

  const eraseAlongPath = useCallback((editor: Editor, path: Point[]) => {
    const zoomLevel = editor.getZoomLevel();
    const pageRadius = eraserSize / 2 / zoomLevel;
    let changed = false;
    if (!path.length) return false;
    const left = Math.min(...path.map(point => point.x)) - pageRadius;
    const right = Math.max(...path.map(point => point.x)) + pageRadius;
    const top = Math.min(...path.map(point => point.y)) - pageRadius;
    const bottom = Math.max(...path.map(point => point.y)) + pageRadius;

    editor.run(() => {
    for (const shape of editor.getCurrentPageShapesSorted()) {
      if (shape.type === 'group' || editor.isShapeOrAncestorLocked(shape) || editor.isShapeHidden(shape)) continue;
      const bounds = editor.getShapePageBounds(shape);
      if (!bounds || bounds.maxX < left || bounds.minX > right || bounds.maxY < top || bounds.minY > bottom) continue;

      if (editor.isShapeOfType<TLDrawShape>(shape, 'draw')) {
        const localPath = path.map(point => editor.getPointInShapeSpace(shape, point));
        const localRadius = pageRadius / Math.max(shape.props.scale, 0.001);
        const result = splitDrawPointsForErase(shape, localPath, localRadius);
        if (!result.touched) continue;

        changed = true;
        if (!result.runs.length) {
          editor.deleteShapes([shape.id]);
          continue;
        }

        const drawProps = {
          ...shape.props,
          segments: [{ type: 'free' as const, points: result.runs[0] }],
          isClosed: false,
          isComplete: true,
        };
        editor.updateShapes<TLDrawShape>([{ id: shape.id, type: 'draw', props: drawProps }]);
        if (result.runs.length > 1) {
          editor.createShapes<TLDrawShape>(result.runs.slice(1).map(points => ({
            id: createShapeId(),
            type: 'draw' as const,
            x: shape.x,
            y: shape.y,
            rotation: shape.rotation,
            parentId: shape.parentId,
            isLocked: shape.isLocked,
            opacity: shape.opacity,
            meta: shape.meta,
            props: { ...drawProps, segments: [{ type: 'free' as const, points }] },
          })));
        }
        continue;
      }

      const geometry = editor.getShapeGeometry(shape);
      const transform = editor.getShapePageTransform(shape).clone().invert();
      const localPath = path.map(point => transform.applyToPoint(point));
      const hit = localPath.length === 1
        ? geometry.hitTestPoint(localPath[0], pageRadius, true)
        : localPath.slice(0, -1).some((point, index) => geometry.hitTestLineSegment(point, localPath[index + 1], pageRadius));
      if (hit) {
        changed = true;
        editor.deleteShapes([shape.id]);
      }
    }
    });

    return changed;
  }, [eraserSize]);

  const handleEraserPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'eraser' || event.button !== 0) return;
    const editor = editorRef.current;
    if (!editor) return;

    // Keep the custom eraser gesture separate from tldraw's selection tool.
    updateBrushCursor(event);
    event.preventDefault();
    event.stopPropagation();
    const pagePoint = editor.screenToPage({ x: event.clientX, y: event.clientY });
    editor.markHistoryStoppingPoint('erase begin');
    eraserGestureRef.current = { pointerId: event.pointerId, path: [pagePoint], processed: pagePoint };
    eraseAlongPath(editor, [pagePoint]);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is not available in some embedded browser surfaces.
    }
  }, [eraseAlongPath, tool, updateBrushCursor]);

  const handleEraserPointerMoveCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = eraserGestureRef.current;
    if (tool !== 'eraser' || !gesture || gesture.pointerId !== event.pointerId) return;
    updateBrushCursor(event);
    event.preventDefault();
    event.stopPropagation();
    const editor = editorRef.current;
    if (!editor) return;
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of [...samples, event]) {
      const point = editor.screenToPage({ x: sample.clientX, y: sample.clientY });
      const previous = gesture.path[gesture.path.length - 1] ?? gesture.processed;
      if (previous.x !== point.x || previous.y !== point.y) gesture.path.push(point);
    }
    if (eraserFrameRef.current !== null) return;
    eraserFrameRef.current = requestAnimationFrame(() => {
      eraserFrameRef.current = null;
      const active = eraserGestureRef.current;
      const currentEditor = editorRef.current;
      if (!active || !currentEditor) return;
      const pending = active.path.splice(0);
      if (!pending.length) return;
      eraseAlongPath(currentEditor, [active.processed, ...pending]);
      active.processed = pending[pending.length - 1];
    });
  }, [eraseAlongPath, tool, updateBrushCursor]);

  const finishEraserGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = eraserGestureRef.current;
    if (tool !== 'eraser' || !gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const editor = editorRef.current;
    if (editor) {
      const pagePoint = editor.screenToPage({ x: event.clientX, y: event.clientY });
      const previousPoint = gesture.path[gesture.path.length - 1];
      if (!previousPoint || previousPoint.x !== pagePoint.x || previousPoint.y !== pagePoint.y) gesture.path.push(pagePoint);
      if (eraserFrameRef.current !== null) { cancelAnimationFrame(eraserFrameRef.current); eraserFrameRef.current = null; }
      const pending = gesture.path.filter(point => point.x !== gesture.processed.x || point.y !== gesture.processed.y);
      if (pending.length) eraseAlongPath(editor, [gesture.processed, ...pending]);
      editor.markHistoryStoppingPoint('erase end');
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    eraserGestureRef.current = null;
  }, [eraseAlongPath, tool]);

  useEffect(() => () => {
    if (eraserFrameRef.current !== null) cancelAnimationFrame(eraserFrameRef.current);
    eraserGestureRef.current = null;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const editor = editorRef.current;
      if (!editor || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo(); else editor.undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selected = editor.getSelectedShapeIds();
        if (selected.length) { event.preventDefault(); editor.deleteShapes(selected); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const applyPaletteColor = useCallback((next: TLDefaultColorStyle) => {
    setColor(next);
    setCustomColorActive(false);
    editorRef.current?.setStyleForNextShapes(DefaultColorStyle, next);
  }, []);

  const applyCustomColor = useCallback((next: string) => {
    setCustomColor(next);
    setCustomColorActive(true);
    editorRef.current?.setStyleForNextShapes(DefaultColorStyle, paletteColorForCustomColor(next));
  }, []);

  const updateSpectrum = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const saturation = clamp((event.clientX - bounds.left) / bounds.width * 100, 0, 100);
    const lightness = clamp(100 - (event.clientY - bounds.top) / bounds.height * 100, 0, 100);
    applyCustomColor(hslToHex(customHsl.h, saturation, lightness));
  }, [applyCustomColor, customHsl.h]);

  const beginSpectrumSelection = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSpectrum(event);
  }, [updateSpectrum]);

  const applyTool = useCallback((name: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    setTool(name);
    setShapeMenu(false);
    if (name.startsWith('geo-')) {
      editor.setStyleForNextShapes(GeoShapeGeoStyle, name.slice(4) as 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'rhombus' | 'hexagon' | 'cloud' | 'heart' | 'octagon' | 'parallelogram' | 'trapezoid');
      editor.setCurrentTool('geo');
      return;
    }
    if (name === 'eraser') {
      editor.setCurrentTool('select');
      return;
    }
    editor.setCurrentTool(name as 'select' | 'draw' | 'text' | 'eraser' | 'line' | 'arrow');
  }, []);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !onSave || saving) return;
    const ids = Array.from(editor.getCurrentPageShapeIds()) as TLShapeId[];
    if (!ids.length) {
      setError('画布还是空的，先画一点内容再完成。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const blob = await exportToBlob({ editor, ids, format: 'png', opts: { scale: 2, background: true } });
      await onSave(new File([blob], 'picup-board.png', { type: 'image/png' }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败，请重试。');
    } finally {
      setSaving(false);
    }
  }, [onClose, onSave, saving]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => editorRef.current?.user.updateUserPreferences({ colorScheme: media.matches ? 'dark' : 'light' });
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const mountEditor = useCallback((editor: Editor) => {
    editorRef.current = editor;
    // Mount effects can replay before asynchronous image insertion finishes.
    if (initializedEditors.current.has(editor)) return;
    initializedEditors.current.add(editor);
    editor.user.updateUserPreferences({ colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' });
    editor.setStyleForNextShapes(DefaultColorStyle, 'black');
    editor.setStyleForNextShapes(DefaultSizeStyle, toTldrawSize(DEFAULT_BRUSH_SIZE));
    editor.setCurrentTool('draw');
    if (!initialImageUrl || editor.getCurrentPageShapes().some(shape => shape.type === 'image')) return;
    void (async () => {
      try {
        const response = await fetch(initialImageUrl);
        if (!response.ok) throw new Error('Image load failed');
        const blob = await response.blob();
        if (editor.isDisposed || editorRef.current !== editor) return;
        const file = new File([blob], 'reference-image.png', { type: blob.type || 'image/png' });
        await editor.putExternalContent({ type: 'files', files: [file], point: editor.getViewportPageBounds().center });
      } catch {
        if (!editor.isDisposed && editorRef.current === editor) setError('原图载入失败，可以继续使用空白画布。');
      }
    })();
  }, [initialImageUrl]);

  return <div className={`board-shell ${tool === 'draw' ? 'is-draw-mode' : ''} ${isEraserMode ? 'is-eraser-mode' : ''}`}>
    <div className="board-engine" onPointerDownCapture={handleEraserPointerDownCapture} onPointerMoveCapture={handleEraserPointerMoveCapture} onPointerUpCapture={finishEraserGesture} onPointerCancelCapture={finishEraserGesture} onPointerEnter={updateBrushCursor} onPointerMove={updateBrushCursor} onPointerLeave={hideBrushCursor}>
      <Tldraw hideUi onMount={mountEditor} />
    </div>
    {(tool === 'draw' || isEraserMode) && <span ref={brushCursorRef} className={`board-brush-cursor ${isEraserMode ? 'is-eraser' : ''}`} style={brushCursorStyle} aria-hidden="true">·</span>}
    <header className="board-header">
      <button type="button" onClick={onClose} aria-label="关闭画板" title="关闭"><X size={22} /></button>
      <div className="board-toolbar">
        <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => applyTool('select')} aria-label="选择工具" title="选择工具"><ArrowUpRight size={19} /></button>
        <button type="button" className={tool === 'draw' ? 'active' : ''} onClick={() => applyTool('draw')} aria-label="画笔" title="画笔"><Paintbrush size={19} /></button>
        <button type="button" className={tool === 'text' ? 'active' : ''} onClick={() => applyTool('text')} aria-label="文字" title="文字"><Type size={19} /></button>
        <button type="button" className={shapeMenu ? 'active' : ''} onClick={() => setShapeMenu(value => !value)} aria-label="形状" title="形状"><Square size={19} /></button>
        <button type="button" className={tool === 'eraser' ? 'active' : ''} onClick={() => applyTool('eraser')} aria-label="橡皮擦" title="橡皮擦"><Eraser size={19} /></button>
        {shapeMenu && <div className="board-shape-menu">{SHAPES.map(([name, label, Icon]) => <button type="button" key={name} onClick={() => applyTool(`geo-${name}`)} aria-label={label} title={label}><Icon size={18} /></button>)}</div>}
      </div>
      <div className="board-history"><button type="button" onClick={() => editorRef.current?.undo()} aria-label="撤销" title="撤销"><RotateCcw size={19} /></button><button type="button" onClick={() => editorRef.current?.redo()} aria-label="重做" title="重做"><RotateCw size={19} /></button></div>
    </header>
    <aside className="board-size-control"><input type="range" min={activeSizeMin} max={activeSizeMax} step={activeSizeStep} value={activeSize} style={{ '--size-progress': `${sizeProgress}%` } as CSSProperties} onChange={event => { const nextValue = Number(event.target.value); if (isEraserMode) { setEraserSize(nextValue); return; } setBrushSize(nextValue); editorRef.current?.setStyleForNextShapes(DefaultSizeStyle, toTldrawSize(nextValue)); }} aria-label={isEraserMode ? '橡皮擦大小' : '笔触粗细'} aria-valuetext={`${activeSizeLabel} 像素`} /></aside>
    <footer className="board-footer"><div className="board-colors">
      <button type="button" className={`board-custom-color ${customColorActive ? 'selected' : ''}`} aria-label="自定义颜色" aria-expanded={colorPickerOpen} title="自定义颜色" onClick={() => setColorPickerOpen(open => !open)}><span style={{ background: customColor }} /></button>
      {COLORS.map(item => <button type="button" key={item.value} aria-label={item.label} title={item.label} className={item.value === color && !customColorActive ? 'selected' : ''} style={{ background: item.swatch }} onClick={() => { applyPaletteColor(item.value); setColorPickerOpen(false); }} />)}
    </div>
      {colorPickerOpen && <div className="board-color-picker" role="group" aria-label="自定义颜色" onPointerDown={event => event.stopPropagation()}>
        <div className="board-color-picker-heading"><strong>自定义颜色</strong><button type="button" className="board-color-picker-close" aria-label="关闭颜色选择" title="关闭" onClick={() => setColorPickerOpen(false)}><X size={15} /></button></div>
        <div className="board-spectrum" role="slider" tabIndex={0} aria-label="饱和度和明度" aria-valuetext={`${Math.round(customHsl.s)}% 饱和度，${Math.round(customHsl.l)}% 明度`} style={{ backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${customHsl.h} 100% 50%))` }} onPointerDown={beginSpectrumSelection} onPointerMove={event => { if (event.buttons) updateSpectrum(event); }} onKeyDown={event => { const saturationDelta = event.key === 'ArrowRight' ? 2 : event.key === 'ArrowLeft' ? -2 : 0; const lightnessDelta = event.key === 'ArrowUp' ? 2 : event.key === 'ArrowDown' ? -2 : 0; if (!saturationDelta && !lightnessDelta) return; event.preventDefault(); applyCustomColor(hslToHex(customHsl.h, customHsl.s + saturationDelta, customHsl.l + lightnessDelta)); }}><span style={{ left: `${customHsl.s}%`, top: `${100 - customHsl.l}%` }} /></div>
        <input className="board-hue-range" type="range" min="0" max="360" value={customHsl.h} onChange={event => applyCustomColor(hslToHex(Number(event.target.value), customHsl.s, customHsl.l))} aria-label="色相" />
        <div className="board-color-preview"><span style={{ background: customColor }} /><output>{customColor.toUpperCase()}</output></div>
        <div className="board-rgb-fields">{(['r', 'g', 'b'] as const).map(channel => <label key={channel}>{channel.toUpperCase()}<input type="number" min="0" max="255" value={customRgb[channel]} onChange={event => applyCustomColor(rgbToHex({ ...customRgb, [channel]: clamp(Number(event.target.value) || 0, 0, 255) }))} /></label>)}</div>
      </div>}
      <div className="board-footer-action">{error && <span className="board-error" role="alert">{error}</span>}<button type="button" className="board-confirm" onClick={save} disabled={saving} aria-label="完成画板" title={saving ? '保存中' : '完成'}>{saving ? <span className="board-spinner" /> : <Check size={20} />}</button></div></footer>
  </div>;
}
