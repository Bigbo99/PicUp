import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface StoragePaths {
  root: string;
  inputs: string;
  outputs: string;
}

export async function ensureStorage(): Promise<StoragePaths> {
  const configuredRoot = process.env.STORAGE_DIR ?? './storage';
  const root = resolve(process.env.PICUP_ROOT ?? process.cwd(), configuredRoot);
  const inputs = resolve(root, 'inputs');
  const outputs = resolve(root, 'outputs');
  await mkdir(inputs, { recursive: true });
  await mkdir(outputs, { recursive: true });
  return { root, inputs, outputs };
}

export function publicMediaUrl(kind: 'inputs' | 'outputs', filename: string) {
  const base = process.env.MEDIA_PUBLIC_BASE_URL ?? '/media';
  return `${base}/${kind}/${filename}`;
}
