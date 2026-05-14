import { spawn } from 'node:child_process';

const port = process.env.WEB_PORT || '3000';
const child = spawn('node', [
  'node_modules/next/dist/bin/next',
  'dev',
  '-H',
  '0.0.0.0',
  '-p',
  port
], {
  cwd: new URL('../apps/web/', import.meta.url),
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
