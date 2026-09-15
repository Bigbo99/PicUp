'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import type { StudioSubject, UploadedFileRecord } from '@picup/shared';
import { createStudioSubject, uploadImage } from '@/lib/api';
import { Dialog } from './dialog';

export function SubjectDialog({ files, onClose, onSaved }: {
  files: UploadedFileRecord[]; onClose: () => void; onSaved: (subject: StudioSubject) => void;
}) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [available, setAvailable] = useState(files);
  const [fileId, setFileId] = useState(files[0]?.id ?? '');
  const [error, setError] = useState('');
  const upload = useMutation({ mutationFn: uploadImage, onSuccess: file => { setAvailable(old => [...old.filter(item => item.id !== file.id), file]); setFileId(file.id); setError(''); }, onError: error => setError(error.message) });
  const save = useMutation({ mutationFn: () => createStudioSubject({ name: name.trim(), description: description.trim(), fileId }), onSuccess: subject => {
    void client.invalidateQueries({ queryKey: ['subjects'] }); void client.invalidateQueries({ queryKey: ['assets'] }); onSaved(subject);
  }, onError: error => setError(error.message) });
  return <Dialog title="创建主体" onClose={onClose}><form className="studio-form settings-content" onSubmit={event => { event.preventDefault(); if (!save.isPending && !upload.isPending && name.trim() && fileId) save.mutate(); }}>
    <label>主体名称<input autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>主体参考图</label><div className="subject-file-options">{available.map(file => <button key={file.id} type="button" aria-label={`选择主体参考图 ${available.indexOf(file) + 1}`} aria-pressed={fileId === file.id} onClick={() => setFileId(file.id)}><img src={file.url} alt="主体参考图" /></button>)}<button type="button" className="studio-icon" title="上传主体图片" aria-label="上传主体图片" disabled={upload.isPending} onClick={() => input.current?.click()}><ImagePlus size={22} /></button></div>
    <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('请选择 10MB 以内的 JPG、PNG 或 WEBP 图片'); return; } upload.mutate(file); }} />
    <label>主体描述<input maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    {error && <p className="studio-error" role="alert">{error}</p>}
    <button className="studio-primary" disabled={save.isPending || upload.isPending || !name.trim() || !fileId}>{save.isPending ? '保存中' : upload.isPending ? '上传中' : '保存主体'}</button>
  </form></Dialog>;
}
