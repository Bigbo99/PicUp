'use client';

import { thumbnailUrl } from '@/lib/thumbnail';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Node, type JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { promptPartsText, type PromptPart, type StudioSubject, type UploadedFileRecord } from '@picup/shared';
import { listStudioSubjects } from '@/lib/api';
import { SubjectDialog } from './subject-dialog';

const ImageMention = Node.create({
  name: 'imageMention', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ fileId: { default: '' }, label: { default: '' }, subjectId: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-image-mention]', getAttrs: element => {
    const fileId = element.getAttribute('data-file-id');
    if (!fileId || !/^[0-9a-f-]{36}$/i.test(fileId)) return false;
    return { fileId, label: (element.getAttribute('data-label') ?? '参考图').slice(0, 120), subjectId: element.getAttribute('data-subject-id') };
  } }],
  renderHTML: ({ node }) => ['span', { 'data-image-mention': '', 'data-file-id': node.attrs.fileId, 'data-label': node.attrs.label, 'data-subject-id': node.attrs.subjectId,
    class: `prompt-image-mention${node.attrs.subjectId ? ' is-subject' : ''}`, contenteditable: 'false', title: `预览 ${node.attrs.label}` },
  ['img', { src: `/api/files/${encodeURIComponent(node.attrs.fileId)}/content`, alt: '', draggable: 'false' }], ['span', {}, node.attrs.label], ...(node.attrs.subjectId ? [['small', {}, '主体']] : [])],
  renderText: ({ node }) => `@${node.attrs.label}`
});

function toDocument(prompt: string, parts?: PromptPart[]): JSONContent {
  const content: JSONContent[] = [];
  for (const part of parts ?? [{ type: 'text', text: prompt }]) {
    if (part.type === 'image') content.push({ type: 'imageMention', attrs: part });
    else part.text.split('\n').forEach((text, index) => { if (index) content.push({ type: 'hardBreak' }); if (text) content.push({ type: 'text', text }); });
  }
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

function fromDocument(doc: JSONContent): PromptPart[] {
  const parts: PromptPart[] = [];
  const appendText = (text: string) => { const last = parts.at(-1); if (last?.type === 'text') last.text += text; else parts.push({ type: 'text', text }); };
  (doc.content ?? []).forEach((block, index) => {
    if (index) appendText('\n');
    (block.content ?? []).forEach(node => {
      if (node.type === 'text') appendText(node.text ?? '');
      else if (node.type === 'hardBreak') appendText('\n');
      else if (node.type === 'imageMention') parts.push({ type: 'image', fileId: node.attrs!.fileId, label: node.attrs!.label, ...(node.attrs!.subjectId ? { subjectId: node.attrs!.subjectId } : {}) });
    });
  });
  return parts;
}

type Choice = { file: UploadedFileRecord; label: string; subjectId?: string };
type MentionAnchor = { from: number; to: number; trigger?: HTMLElement };
export type MentionEditorHandle = { focus: () => void; openMentions: (trigger: HTMLElement) => void; insertSubject: (subject: StudioSubject) => void };
type Props = {
  prompt: string; parts?: PromptPart[]; files: UploadedFileRecord[]; disabled: boolean; placeholder: string; userId?: string;
  onChange: (prompt: string, parts: PromptPart[], file?: UploadedFileRecord) => void;
  canAdd: (file: UploadedFileRecord) => boolean;
  onPreview: (fileId: string, label: string) => void;
  onKeyDown: (event: KeyboardEvent) => void; onBlur: () => void;
};

export const MentionEditor = forwardRef<MentionEditorHandle, Props>(function MentionEditor(props, ref) {
  const latest = useRef(props); latest.current = props;
  const [anchor, setAnchor] = useState<MentionAnchor | null>(null);
  const anchorRef = useRef(anchor); anchorRef.current = anchor;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(0);
  const [creating, setCreating] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0, maxHeight: 300 });
  const menu = useRef<HTMLDivElement>(null);
  const choicesRef = useRef<Choice[]>([]);
  const selectedRef = useRef(0); selectedRef.current = selected;
  const insertRef = useRef<(choice: Choice) => void>(() => {});
  const createRef = useRef<() => void>(() => {});
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, code: false, codeBlock: false, bold: false, italic: false, strike: false, horizontalRule: false, link: false, underline: false, dropcursor: false, gapcursor: false, trailingNode: false }), ImageMention],
    content: toDocument(props.prompt, props.parts),
    editorProps: {
      attributes: { id: 'studio-prompt', class: 'studio-prompt-editor', role: 'textbox', 'aria-label': '创作描述', 'aria-multiline': 'true' },
      handleClickOn: (_view, _pos, node, _nodePos, event, direct) => {
        if (!direct || node.type.name !== 'imageMention' || event.button !== 0) return false;
        setAnchor(null);
        latest.current.onPreview(node.attrs.fileId, node.attrs.label);
        return true;
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing) return false;
        const selectedNode = view.state.selection instanceof NodeSelection ? view.state.selection.node : null;
        if (event.key === 'Enter' && selectedNode?.type.name === 'imageMention') {
          setAnchor(null);
          latest.current.onPreview(selectedNode.attrs.fileId, selectedNode.attrs.label);
          return true;
        }
        if (anchorRef.current) {
          if (event.key === 'Escape') { setAnchor(null); return true; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { const count = choicesRef.current.length + 1; setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count); return true; }
          if (event.key === 'Enter') { const choice = choicesRef.current[selectedRef.current - 1]; if (choice) insertRef.current(choice); else createRef.current(); return true; }
        }
        latest.current.onKeyDown(event); return event.defaultPrevented;
      }
    },
    onBlur: () => latest.current.onBlur(),
    onUpdate: ({ editor }) => {
      const parts = fromDocument(editor.getJSON());
      latest.current.onChange(promptPartsText(parts), parts);
      const { $from, empty, from } = editor.state.selection;
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
      const match = empty && before.match(/@([^@\s\ufffc]*)$/);
      if (match && !editor.view.composing) { setAnchor({ from: from - match[0].length, to: from }); setSearch(match[1]); setSelected(0); }
      else if (!anchorRef.current?.trigger) setAnchor(null);
    },
    onSelectionUpdate: ({ editor }) => { const current = anchorRef.current; if (current && !current.trigger && editor.state.selection.from !== current.to) setAnchor(null); }
  });
  useEffect(() => { editor?.setEditable(!props.disabled, false); }, [editor, props.disabled]);
  useEffect(() => {
    if (!editor) return;
    const parts = fromDocument(editor.getJSON());
    if (props.prompt !== promptPartsText(parts) || JSON.stringify(props.parts ?? []) !== JSON.stringify(parts.some(part => part.type === 'image') ? parts : [])) {
      editor.commands.setContent(toDocument(props.prompt, props.parts), { emitUpdate: false });
    }
  }, [editor, props.prompt, props.parts]);

  const subjects = useInfiniteQuery({ queryKey: ['subjects', props.userId, search], initialPageParam: 0,
    queryFn: ({ pageParam }) => listStudioSubjects(search, pageParam), getNextPageParam: page => page.next ?? undefined, enabled: Boolean(anchor && props.userId), staleTime: 20_000 });
  const choices: Choice[] = [
    ...props.files.map((file, index) => ({ file, label: `参考图 ${index + 1}` })).filter(choice => choice.label.includes(search)),
    ...(subjects.data?.pages.flatMap(page => page.items) ?? []).map(subject => ({ file: subject.file, label: subject.name, subjectId: subject.id }))
  ];
  choicesRef.current = choices;
  function insert(choice: Choice) {
    if (!editor || latest.current.disabled || !latest.current.canAdd(choice.file)) return;
    const current = anchorRef.current;
    // Add the file and serialized content together so no intermediate draft loses its binding.
    editor.chain().insertContentAt(current ? { from: current.from, to: current.to } : editor.state.selection,
      [{ type: 'imageMention', attrs: { fileId: choice.file.id, label: choice.label, subjectId: choice.subjectId ?? null } }, { type: 'text', text: ' ' }], { updateSelection: true }).run();
    editor.view.focus();
    const parts = fromDocument(editor.getJSON());
    latest.current.onChange(promptPartsText(parts), parts, choice.file); setAnchor(null);
  }
  insertRef.current = insert;
  createRef.current = () => setCreating(true);
  useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus(), openMentions: trigger => {
    if (!editor || props.disabled) return;
    setAnchor(current => current ? null : { from: editor.state.selection.from, to: editor.state.selection.to, trigger }); setSearch(''); setSelected(0);
  }, insertSubject: subject => insert({ file: subject.file, label: subject.name, subjectId: subject.id }) }));

  useEffect(() => {
    if (!anchor || !editor) return;
    function place() {
      if (!editor || editor.isDestroyed) return;
      const bounds = anchor!.trigger?.getBoundingClientRect() ?? editor.view.coordsAtPos(Math.min(anchor!.from, editor.state.doc.content.size));
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0, width = viewport?.width ?? window.innerWidth;
      setPosition({ left: Math.max(left + 12, Math.min(bounds.left, left + width - Math.min(340, width - 24) - 12)),
        bottom: window.innerHeight - bounds.top + 8, maxHeight: Math.max(56, Math.min(360, bounds.top - top - 20)) });
    }
    function outside(event: PointerEvent) { if (!creating && !menu.current?.contains(event.target as globalThis.Node) && !anchor!.trigger?.contains(event.target as globalThis.Node) && !editor!.view.dom.contains(event.target as globalThis.Node)) setAnchor(null); }
    function escape(event: globalThis.KeyboardEvent) { if (!creating && event.key === 'Escape' && !event.isComposing) setAnchor(null); }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true); window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [anchor, editor, creating]);
  useEffect(() => { menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  return <>
    <div className="mention-editor-wrap" data-placeholder={props.placeholder} data-empty={!props.prompt}><EditorContent editor={editor} /></div>
    {anchor && !creating && createPortal(<div ref={menu} className="studio-mention-menu" style={position} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setAnchor(null); editor?.commands.focus(); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : choices.length)) % (choices.length + 1)); }
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); if (selected > 0 && choices[selected - 1]) insert(choices[selected - 1]); else setCreating(true); }
    }}>
      <label className="search-field"><Search size={16} /><input aria-label="搜索图片或主体" placeholder="搜索图片或主体" value={search} onChange={event => { setSearch(event.target.value); setSelected(0); }} /></label>
      <div role="listbox" aria-label="图片与主体选项"><button type="button" role="option" aria-selected={selected === 0} className="mention-option" onPointerDown={event => event.preventDefault()} onClick={() => setCreating(true)}><Plus size={20} /><span>创建主体</span></button>
      {choices.map((choice, index) => <div key={choice.subjectId ?? choice.file.id}>{(index === 0 || Boolean(choice.subjectId) !== Boolean(choices[index - 1].subjectId)) && <div className="mention-group-label">{choice.subjectId ? '我的主体' : '参考图片'}</div>}<button type="button" role="option" className="mention-option" aria-selected={selected === index + 1} onPointerDown={event => event.preventDefault()} onClick={() => insert(choice)}><img src={thumbnailUrl(choice.file)} alt="" /><span>{choice.label}</span>{choice.subjectId && <small>主体</small>}</button></div>)}
      </div>
      {subjects.isPending && <p className="mention-group-label">正在加载主体</p>}{subjects.isError && <button type="button" className="studio-text-button" onClick={() => subjects.refetch()}>主体加载失败，重试</button>}
      {subjects.hasNextPage && <button type="button" className="studio-text-button" disabled={subjects.isFetchingNextPage} onClick={() => subjects.fetchNextPage()}>更多主体</button>}
      {!choices.length && !subjects.isPending && <p className="mention-group-label">没有匹配的图片或主体</p>}
    </div>, document.body)}
    {creating && <SubjectDialog files={props.files} onClose={() => setCreating(false)} onSaved={subject => { setCreating(false); insert({ file: subject.file, label: subject.name, subjectId: subject.id }); }} />}
  </>;
});
