import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../../../.env')
  ];
  const envPath = candidates.find((path) => existsSync(path));
  config({ path: envPath ?? candidates[0] });
  if (envPath) {
    process.env.PICUP_ROOT = resolve(envPath, '..');
  }
}
