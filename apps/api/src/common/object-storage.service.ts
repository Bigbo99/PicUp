import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { ensureStorage, publicMediaUrl } from './storage-paths';

type MediaKind = 'inputs' | 'outputs';
const DEFAULT_QINIU_TIMEOUT_MS = 120_000;
const DEFAULT_QINIU_RETRY_ATTEMPTS = 3;
const retryableStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class ObjectStorageService {
  private readonly qiniuDispatchers = new Map<string, Dispatcher>();
  private readonly pendingReads = new Map<string, Promise<Buffer>>();
  private readonly objectOperations = new Map<string, Promise<unknown>>();
  private cacheCleanupPromise: Promise<void> | null = null;
  private cacheCleanupRequested = false;

  async save(kind: MediaKind, filename: string, body: Buffer, mimeType: string) {
    if (this.isQiniuEnabled()) {
      const key = this.keyFor(kind, filename);
      const url = this.publicUrlForKey(key);
      this.pendingReads.delete(url);
      return this.withObjectOperation(url, async () => {
        await this.requestQiniu('PUT', key, body, mimeType);
        // Seed the shared disk cache while the worker still has the bytes.
        // The API can then serve the first preview without another Qiniu GET.
        await this.invalidateDiskCache(url);
        await this.writeDiskCache(url, body);
        return url;
      });
    }

    const paths = await ensureStorage();
    const dir = kind === 'inputs' ? paths.inputs : paths.outputs;
    await writeFile(resolve(dir, filename), body);
    return publicMediaUrl(kind, filename);
  }

  async readByUrl(url: string) {
    if (this.isQiniuEnabled() && !this.isLegacyLocalUrl(url)) {
      const key = this.keyFromUrl(url);
      const cacheUrl = this.publicUrlForKey(key);
      const pending = this.pendingReads.get(cacheUrl);
      if (pending) return pending;
      const read = this.withObjectOperation(cacheUrl, async () => {
        const cached = await this.readDiskCache(cacheUrl);
        if (cached) return cached;
        const body = await this.requestQiniu('GET', key);
        await this.writeDiskCache(cacheUrl, body);
        return body;
      });
      this.pendingReads.set(cacheUrl, read);
      try {
        return await read;
      } finally {
        if (this.pendingReads.get(cacheUrl) === read) this.pendingReads.delete(cacheUrl);
      }
    }

    const { kind, filename } = this.localPartsFromUrl(url);
    const paths = await ensureStorage();
    return readFile(resolve(kind === 'inputs' ? paths.inputs : paths.outputs, filename));
  }

  // A GET started before a PUT/DELETE must not repopulate stale cache bytes
  // after that mutation. Only operations on the same object wait for each other.
  private withObjectOperation<T>(url: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.objectOperations.get(url) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.objectOperations.set(url, current);
    const clear = () => {
      if (this.objectOperations.get(url) === current) this.objectOperations.delete(url);
    };
    void current.then(clear, clear);
    return current;
  }

  private async cachePath(url: string) {
    const paths = await ensureStorage();
    return resolve(paths.root, 'cache', 'objects', createHash('sha256').update(url).digest('hex'));
  }

  private async readDiskCache(url: string) {
    if (!this.cacheEnabled()) return null;
    try {
      const path = await this.cachePath(url);
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > this.cacheTtlMs() || info.size > this.cacheLimit('OBJECT_CACHE_MAX_BYTES', 1024 * 1024 * 1024)) {
        await unlink(path).catch(() => undefined);
        return null;
      }
      const body = await readFile(path);
      // mtime records last use, shared across API and worker processes.
      const now = new Date();
      await utimes(path, now, now).catch(() => undefined);
      return body;
    } catch {
      return null;
    }
  }

  private async writeDiskCache(url: string, body: Buffer) {
    if (!this.cacheEnabled() || body.length > this.cacheLimit('OBJECT_CACHE_MAX_BYTES', 1024 * 1024 * 1024)) return;
    try {
      const path = await this.cachePath(url);
      await mkdir(resolve(path, '..'), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, body, { flag: 'wx', mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      await this.cleanupDiskCache();
    } catch (error) {
      console.warn('[storage] unable to write disk cache', error);
    }
  }

  private async cleanupDiskCache() {
    this.cacheCleanupRequested = true;
    if (this.cacheCleanupPromise) return this.cacheCleanupPromise;
    this.cacheCleanupPromise = (async () => {
      try {
        const paths = await ensureStorage();
        const dir = resolve(paths.root, 'cache', 'objects');
        do {
          this.cacheCleanupRequested = false;
          const now = Date.now();
          const names = await readdir(dir);
          const files = await Promise.all(names.map(async (name) => {
            const path = resolve(dir, name);
            try {
              const info = await stat(path);
              if (!/^[a-f0-9]{64}$/.test(name)) {
                if (/^[a-f0-9]{64}\.[a-f0-9-]+\.tmp$/.test(name) && now - info.mtimeMs > 60 * 60_000) {
                  await unlink(path).catch(() => undefined);
                }
                return null;
              }
              return { path, size: info.size, mtimeMs: info.mtimeMs };
            } catch { return null; }
          }));
          const active = files.filter((file): file is { path: string; size: number; mtimeMs: number } => Boolean(file));
          const maxFiles = this.cacheLimit('OBJECT_CACHE_MAX_FILES', 1000);
          const maxBytes = this.cacheLimit('OBJECT_CACHE_MAX_BYTES', 1024 * 1024 * 1024);
          active.sort((a, b) => a.mtimeMs - b.mtimeMs);
          let total = active.reduce((sum, file) => sum + file.size, 0);
          let count = active.length;
          for (const file of active) {
            if (count <= maxFiles && total <= maxBytes && now - file.mtimeMs <= this.cacheTtlMs()) break;
            // Another process may have read/replaced the file since the scan.
            const current = await stat(file.path).catch(() => null);
            if (current && current.mtimeMs !== file.mtimeMs) continue;
            await unlink(file.path).catch(() => undefined);
            total -= file.size;
            count--;
          }
        } while (this.cacheCleanupRequested);
      } finally {
        this.cacheCleanupPromise = null;
      }
    })();
    return this.cacheCleanupPromise;
  }

  private cacheLimit(name: string, fallback: number) {
    const configured = process.env[name]?.trim();
    const value = configured ? Number(configured) : NaN;
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  }

  private cacheTtlMs() {
    return this.cacheLimit('OBJECT_CACHE_TTL_SECONDS', 7 * 24 * 60 * 60) * 1000;
  }

  private cacheEnabled() {
    return this.cacheLimit('OBJECT_CACHE_MAX_FILES', 1000) > 0
      && this.cacheLimit('OBJECT_CACHE_MAX_BYTES', 1024 * 1024 * 1024) > 0
      && this.cacheTtlMs() > 0;
  }

  async deleteByUrl(url: string) {
    if (this.isQiniuEnabled() && !this.isLegacyLocalUrl(url)) {
      const key = this.keyFromUrl(url);
      const cacheUrl = this.publicUrlForKey(key);
      this.pendingReads.delete(cacheUrl);
      await this.withObjectOperation(cacheUrl, async () => {
        await this.requestQiniu('DELETE', key).catch((error) => {
          if (error instanceof Error && error.message.includes(' 404 ')) return;
          throw error;
        });
        await this.invalidateDiskCache(cacheUrl);
      });
      return;
    }

    const { kind, filename } = this.localPartsFromUrl(url);
    const paths = await ensureStorage();
    const dir = kind === 'inputs' ? paths.inputs : paths.outputs;
    await unlink(resolve(dir, filename));
  }

  private async invalidateDiskCache(url: string) {
    if (!this.isQiniuEnabled() || this.isLegacyLocalUrl(url)) return;
    try { await unlink(await this.cachePath(url)); } catch { /* cache may not exist */ }
  }

  filenameFromUrl(url: string) {
    const parsed = new URL(url, 'http://localhost');
    const filename = parsed.pathname.split('/').pop();
    if (!filename) throw new Error(`Cannot resolve filename from URL: ${url}`);
    return filename;
  }

  private isQiniuEnabled() {
    return (process.env.STORAGE_DRIVER ?? 'local').toLowerCase() === 'qiniu';
  }

  private keyFor(kind: MediaKind, filename: string) {
    return `${kind}/${filename}`;
  }

  private publicUrlForKey(key: string) {
    const base = process.env.QINIU_PUBLIC_BASE_URL?.trim();
    if (!base) throw new Error('QINIU_PUBLIC_BASE_URL is required when STORAGE_DRIVER=qiniu');
    return `${base.replace(/\/+$/, '')}/${this.encodePath(key)}`;
  }

  private keyFromUrl(url: string) {
    const publicBase = process.env.QINIU_PUBLIC_BASE_URL?.trim();
    const parsed = new URL(url, publicBase || 'http://localhost');
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  }

  private isLegacyLocalUrl(url: string) {
    const parsed = new URL(url, 'http://localhost');
    return parsed.pathname.startsWith('/media/');
  }

  private localPartsFromUrl(url: string): { kind: MediaKind; filename: string } {
    const parsed = new URL(url, 'http://localhost');
    const parts = parsed.pathname.split('/').filter(Boolean);
    const mediaIndex = parts[0] === 'media' ? 1 : 0;
    const kind = parts[mediaIndex] as MediaKind | undefined;
    const filename = parts[mediaIndex + 1];
    if ((kind !== 'inputs' && kind !== 'outputs') || !filename) {
      throw new Error(`Cannot resolve local media path from URL: ${url}`);
    }
    return { kind, filename };
  }

  private async requestQiniu(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Buffer, mimeType?: string) {
    const config = this.qiniuConfig();
    const canonicalUri = `/${this.encodePath(key)}`;
    const endpoint = config.endpoint.replace(/\/+$/, '');
    const requestUrl = `${endpoint}${canonicalUri}`;
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = this.sha256Hex(payload);
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const host = new URL(endpoint).host;

    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    };
    if (mimeType) headers['content-type'] = mimeType;

    const { authorization, signedHeaders } = this.sign({
      method,
      canonicalUri,
      payloadHash,
      headers,
      dateStamp,
      amzDate,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region
    });

    const attempts = this.qiniuRetryAttempts();
    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(requestUrl, {
          method,
          headers: {
            ...headers,
            Authorization: authorization
          },
          body: method === 'PUT' ? new Uint8Array(payload) : undefined,
          dispatcher: this.qiniuDispatcher()
        } as RequestInit & { dispatcher: Dispatcher });

        if (response.ok) return Buffer.from(await response.arrayBuffer());

        const message = await response.text().catch(() => '');
        lastError = `HTTP ${response.status} signed=${signedHeaders} ${message}`;
        if (!retryableStatusCodes.has(response.status)) break;
      } catch (error) {
        lastError = this.describeNetworkError(error);
      }

      console.warn(`[qiniu] ${method} retry key=${key} attempt=${attempt}/${attempts} error=${lastError}`);
      await this.sleep(500 * attempt);
    }

    throw new Error(`Qiniu ${method} failed key=${key}: ${lastError}`);
  }

  private qiniuDispatcher(): Dispatcher {
    const timeoutMs = this.qiniuTimeoutMs();
    const proxy = process.env.QINIU_PROXY_URL?.trim();
    const key = `${proxy ?? 'direct'}:${timeoutMs}`;
    const existing = this.qiniuDispatchers.get(key);
    if (existing) return existing;

    const options = {
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connectTimeout: Math.min(timeoutMs, 30_000)
    };
    const dispatcher = proxy ? new ProxyAgent({ uri: proxy, ...options }) : new Agent(options);
    this.qiniuDispatchers.set(key, dispatcher);
    return dispatcher;
  }

  private qiniuTimeoutMs() {
    const value = Number(process.env.QINIU_TIMEOUT_MS);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_QINIU_TIMEOUT_MS;
  }

  private qiniuRetryAttempts() {
    const value = Number(process.env.QINIU_RETRY_ATTEMPTS);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_QINIU_RETRY_ATTEMPTS;
  }

  private describeNetworkError(error: unknown) {
    if (!(error instanceof Error)) return String(error);
    const cause = error.cause;
    if (cause && typeof cause === 'object') {
      const code = 'code' in cause ? String(cause.code) : '';
      const message = 'message' in cause ? String(cause.message) : '';
      return [error.message, code, message].filter(Boolean).join(' / ');
    }
    return error.message;
  }

  private sleep(ms: number) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
  }

  private sign(input: {
    method: string;
    canonicalUri: string;
    payloadHash: string;
    headers: Record<string, string>;
    dateStamp: string;
    amzDate: string;
    accessKey: string;
    secretKey: string;
    region: string;
  }) {
    const sortedHeaderNames = Object.keys(input.headers).sort();
    const canonicalHeaders = sortedHeaderNames
      .map((name) => `${name}:${input.headers[name].trim()}\n`)
      .join('');
    const signedHeaders = sortedHeaderNames.join(';');
    const canonicalRequest = [
      input.method,
      input.canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      input.payloadHash
    ].join('\n');

    const credentialScope = `${input.dateStamp}/${input.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      input.amzDate,
      credentialScope,
      this.sha256Hex(Buffer.from(canonicalRequest))
    ].join('\n');

    const signingKey = this.hmac(
      this.hmac(
        this.hmac(
          this.hmac(Buffer.from(`AWS4${input.secretKey}`), input.dateStamp),
          input.region
        ),
        's3'
      ),
      'aws4_request'
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    return {
      signedHeaders,
      authorization: [
        `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`
      ].join(', ')
    };
  }

  private qiniuConfig() {
    const accessKey = process.env.QINIU_ACCESS_KEY?.trim();
    const secretKey = process.env.QINIU_SECRET_KEY?.trim();
    const bucket = process.env.QINIU_S3_BUCKET_NAME?.trim() || process.env.QINIU_BUCKET?.trim();
    const region = process.env.QINIU_REGION?.trim() || 'cn-east-1';
    if (!accessKey || !secretKey || !bucket) {
      throw new Error('QINIU_ACCESS_KEY, QINIU_SECRET_KEY, and QINIU_BUCKET are required when STORAGE_DRIVER=qiniu');
    }
    return {
      accessKey,
      secretKey,
      bucket,
      region,
      endpoint: process.env.QINIU_S3_ENDPOINT?.trim() || `https://${bucket}.s3.${region}.qiniucs.com`
    };
  }

  private encodePath(path: string) {
    return path.split('/').map((part) => encodeURIComponent(part)).join('/');
  }

  private sha256Hex(body: Buffer) {
    return createHash('sha256').update(body).digest('hex');
  }

  private hmac(key: Buffer, value: string) {
    return createHmac('sha256', key).update(value).digest();
  }

  private amzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }
}
