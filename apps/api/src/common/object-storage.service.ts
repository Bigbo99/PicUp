import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
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
  private readonly diskCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
  private lastCacheCleanupAt = 0;
  private cacheCleanupPromise: Promise<void> | null = null;

  async save(kind: MediaKind, filename: string, body: Buffer, mimeType: string) {
    if (this.isQiniuEnabled()) {
      const key = this.keyFor(kind, filename);
      await this.requestQiniu('PUT', key, body, mimeType);
      return this.publicUrlForKey(key);
    }

    const paths = await ensureStorage();
    const dir = kind === 'inputs' ? paths.inputs : paths.outputs;
    await writeFile(resolve(dir, filename), body);
    return publicMediaUrl(kind, filename);
  }

  async readByUrl(url: string) {
    const diskCache = await this.readDiskCache(url);
    if (diskCache) return diskCache;
    let body: Buffer;
    if (this.isQiniuEnabled() && !this.isLegacyLocalUrl(url)) {
      const key = this.keyFromUrl(url);
      body = await this.requestQiniu('GET', key);
    } else {
      const { kind, filename } = this.localPartsFromUrl(url);
      const paths = await ensureStorage();
      const dir = kind === 'inputs' ? paths.inputs : paths.outputs;
      body = await readFile(resolve(dir, filename));
    }
    await this.writeDiskCache(url, body);
    return body;
  }

  private async cachePath(url: string) {
    const paths = await ensureStorage();
    return resolve(paths.root, 'cache', 'objects', createHash('sha256').update(url).digest('hex'));
  }

  private async readDiskCache(url: string) {
    if (!this.isQiniuEnabled() || this.isLegacyLocalUrl(url)) return null;
    try {
      const path = await this.cachePath(url);
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > this.diskCacheTtlMs) {
        await unlink(path).catch(() => undefined);
        return null;
      }
      return await readFile(path);
    } catch {
      return null;
    }
  }

  private async writeDiskCache(url: string, body: Buffer) {
    if (!this.isQiniuEnabled() || this.isLegacyLocalUrl(url)) return;
    try {
      const path = await this.cachePath(url);
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, body);
      void this.cleanupDiskCache();
    } catch (error) {
      console.warn('[storage] unable to write disk cache', error);
    }
  }

  private async cleanupDiskCache() {
    const now = Date.now();
    if (this.cacheCleanupPromise || now - this.lastCacheCleanupAt < 5 * 60_000) return this.cacheCleanupPromise ?? undefined;
    this.lastCacheCleanupAt = now;
    this.cacheCleanupPromise = (async () => {
      try {
        const paths = await ensureStorage();
        const dir = resolve(paths.root, 'cache', 'objects');
        const names = await readdir(dir).catch(() => [] as string[]);
        const files = await Promise.all(names.map(async (name) => {
          const path = resolve(dir, name);
          try {
            const info = await stat(path);
            return { path, size: info.size, mtimeMs: info.mtimeMs };
          } catch { return null; }
        }));
        const active = files.filter((file): file is { path: string; size: number; mtimeMs: number } => Boolean(file));
        const maxFiles = this.cacheLimit('OBJECT_CACHE_MAX_FILES', 1000);
        const maxBytes = this.cacheLimit('OBJECT_CACHE_MAX_BYTES', 1024 * 1024 * 1024);
        active.sort((a, b) => a.mtimeMs - b.mtimeMs);
        let total = active.reduce((sum, file) => sum + file.size, 0);
        while (active.length > maxFiles || total > maxBytes) {
          const file = active.shift();
          if (!file) break;
          total -= file.size;
          await unlink(file.path).catch(() => undefined);
        }
        const expiry = Date.now() - this.diskCacheTtlMs;
        await Promise.all(active.filter((file) => file.mtimeMs < expiry).map((file) => unlink(file.path).catch(() => undefined)));
      } finally {
        this.cacheCleanupPromise = null;
      }
    })();
    return this.cacheCleanupPromise;
  }

  private cacheLimit(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  async deleteByUrl(url: string) {
    await this.invalidateDiskCache(url);
    if (this.isQiniuEnabled() && !this.isLegacyLocalUrl(url)) {
      const key = this.keyFromUrl(url);
      await this.requestQiniu('DELETE', key).catch((error) => {
        if (error instanceof Error && error.message.includes(' 404 ')) return;
        throw error;
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
