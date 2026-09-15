import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function port(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} 必须是 1 到 65535 之间的整数。`);
  }
  return parsed;
}

const requestedWebPort = port(option('--web-port') ?? process.env.LOCAL_WEB_PORT ?? process.env.WEB_PORT, 3001, 'Web 端口');
const requestedApiPort = port(option('--api-port') ?? process.env.LOCAL_API_PORT ?? process.env.API_PORT, 4318, 'API 端口');

function probePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', resolve);
    server.listen(port, '0.0.0.0', () => server.close(() => resolve(null)));
  });
}

async function findAvailablePort(requested, label, excluded = new Set()) {
  let firstError;
  for (let candidate = requested; candidate < Math.min(65536, requested + 100); candidate += 1) {
    if (excluded.has(candidate)) continue;
    const error = await probePort(candidate);
    if (!error) {
      if (candidate !== requested) {
        const reason = firstError?.code === 'EACCES' ? '被系统保留或禁止绑定' : '已被占用';
        console.warn(`[dev] ${label} 端口 ${requested} ${reason}，自动使用 ${candidate}`);
      }
      return candidate;
    }
    firstError ??= error;
  }
  throw new Error(`${label} 从端口 ${requested} 开始连续 100 个端口均不可用。最后错误：${firstError?.code ?? '未知错误'}。`);
}

function stopExistingPicUpDevProcesses() {
  if (process.platform !== 'win32') return;
  const escapedWorkspace = workspace.replace(/'/g, "''");
  const script = [
    `$workspace='${escapedWorkspace}'`,
    `$currentPid=${process.pid}`,
    '$targets=Get-CimInstance Win32_Process | Where-Object {',
    "  $_.ProcessId -ne $currentPid -and $_.CommandLine -like \"*$workspace*\" -and ($_.CommandLine -match 'scripts[\\\\/]dev-local[.]mjs|next[\\\\/]dist[\\\\/]server[\\\\/]lib[\\\\/]start-server|tsx.*(?:src[\\\\/]main|src[\\\\/]workers[\\\\/]image-worker)')",
    '}',
    'foreach($target in $targets){ taskkill /PID $target.ProcessId /T /F 2>$null | Out-Null }'
  ].join(';');
  spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
}

stopExistingPicUpDevProcesses();

const resolvedWebPort = await findAvailablePort(requestedWebPort, 'Web');
const resolvedApiPort = await findAvailablePort(requestedApiPort, 'API', new Set([resolvedWebPort]));
const webPort = String(resolvedWebPort);
const apiPort = String(resolvedApiPort);
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://picup:picup_password@localhost:15432/picup?schema=public';
const redisUrl = process.env.LOCAL_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:16379';

function servicePort(url) {
  const parsed = new URL(url);
  return Number(parsed.port || (parsed.protocol === 'postgresql:' ? 5432 : 6379));
}

async function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(800, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function waitForDependencies() {
  const databasePort = servicePort(databaseUrl);
  const redisPort = servicePort(redisUrl);
  if (await canConnect(databasePort) && await canConnect(redisPort)) return;

  const docker = spawnSync('docker', ['compose', 'up', '-d', 'postgres', 'redis'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, POSTGRES_PUBLISH_PORT: String(databasePort), REDIS_PUBLISH_PORT: String(redisPort) }
  });
  if (docker.status !== 0) {
    throw new Error('本地 PostgreSQL 和 Redis 未运行，且 Docker Desktop 当前不可用。请启动 Docker Desktop 后重试 npm run dev。');
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await canConnect(databasePort) && await canConnect(redisPort)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`本地依赖未在 60 秒内就绪（PostgreSQL :${databasePort}，Redis :${redisPort}）。`);
}

await waitForDependencies();

const commands = [
  {
    name: 'web',
    args: ['--filter', '@picup/web', 'dev'],
    env: {
      WEB_PORT: webPort,
      NEXT_DIST_DIR: '.next-dev',
      API_INTERNAL_URL: `http://localhost:${apiPort}`,
      NEXT_PUBLIC_API_BASE_URL: ''
    }
  },
  {
    name: 'api',
    args: ['--filter', '@picup/api', 'dev'],
    env: {
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl
    }
  },
  {
    name: 'worker',
    args: ['--filter', '@picup/api', 'dev:worker'],
    env: {
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl
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
    if (child.killed || !child.pid) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill(signal);
  }
}

for (const command of commands) {
  const child = spawn('pnpm', command.args, {
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...command.env,
      APP_ENV: 'development',
      NODE_ENV: 'development',
      ...(command.name !== 'web' ? {
        API_PORT: apiPort,
        WEB_PUBLIC_URL: `http://localhost:${webPort}`,
        API_PUBLIC_URL: `http://localhost:${apiPort}`,
        MEDIA_PUBLIC_BASE_URL: `http://localhost:${apiPort}/media`
      } : {})
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
    if (!closing) {
      console.error(`[${command.name}] exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}; stopping local services`);
      stopAll();
      process.exitCode = code ?? 1;
    }
  });
}

process.on('SIGINT', () => { stopAll('SIGINT'); process.exit(130); });
process.on('SIGTERM', () => { stopAll('SIGTERM'); process.exit(143); });

console.log(`[dev] Web: http://localhost:${webPort}`);
console.log(`[dev] API: http://localhost:${apiPort}`);
