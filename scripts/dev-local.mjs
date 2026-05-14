import { spawn } from 'node:child_process';

const commands = [
  {
    name: 'web',
    args: ['--filter', '@picup/web', 'dev'],
    env: {
      WEB_PORT: '3001',
      NEXT_DIST_DIR: '.next-dev',
      API_INTERNAL_URL: 'http://localhost:4001',
      NEXT_PUBLIC_API_BASE_URL: ''
    }
  },
  {
    name: 'api',
    args: ['--filter', '@picup/api', 'dev'],
    env: {
      API_PORT: '4001',
      WEB_PUBLIC_URL: 'http://localhost:3001',
      API_PUBLIC_URL: 'http://localhost:4001',
      MEDIA_PUBLIC_BASE_URL: 'http://localhost:4001/media',
      DATABASE_URL: process.env.LOCAL_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://picup:picup_password@localhost:5432/picup?schema=public',
      REDIS_URL: process.env.LOCAL_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379'
    }
  },
  {
    name: 'worker',
    args: ['--filter', '@picup/api', 'dev:worker'],
    env: {
      API_PORT: '4001',
      WEB_PUBLIC_URL: 'http://localhost:3001',
      API_PUBLIC_URL: 'http://localhost:4001',
      MEDIA_PUBLIC_BASE_URL: 'http://localhost:4001/media',
      DATABASE_URL: process.env.LOCAL_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://picup:picup_password@localhost:5432/picup?schema=public',
      REDIS_URL: process.env.LOCAL_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379'
    }
  }
];

const children = [];
let closing = false;

function stopAll(signal = 'SIGTERM') {
  if (closing) {
    return;
  }
  closing = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const command of commands) {
  const child = spawn('pnpm', command.args, {
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...command.env
    }
  });

  children.push(child);

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${command.name}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${command.name}] ${chunk}`);
  });

  child.on('exit', (code, signal) => {
    if (!closing && code !== 0) {
      console.error(`[${command.name}] exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`);
      stopAll();
      process.exitCode = code ?? 1;
    }
  });
}

process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
