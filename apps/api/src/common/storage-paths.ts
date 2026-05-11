import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface StoragePaths {
  root: string;
  inputs: string;
  outputs: string;
  db: string;
}

export async function ensureStorage(): Promise<StoragePaths> {
  const configuredRoot = process.env.STORAGE_DIR ?? './storage';
  const root = resolve(process.env.PICUP_ROOT ?? process.cwd(), configuredRoot);
  const inputs = resolve(root, 'inputs');
  const outputs = resolve(root, 'outputs');
  const db = resolve(root, 'db.json');
  await mkdir(inputs, { recursive: true });
  await mkdir(outputs, { recursive: true });
  return { root, inputs, outputs, db };
}

export function publicMediaUrl(kind: 'inputs' | 'outputs', filename: string) {
  const base = process.env.MEDIA_PUBLIC_BASE_URL ?? '/media';
  return `${base}/${kind}/${filename}`;
}
