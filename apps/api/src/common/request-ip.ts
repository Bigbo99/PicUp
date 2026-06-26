import type { Request } from 'express';
import { isIP } from 'node:net';

function headerValue(value: Request['headers'][string]) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanIp(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withoutPort = trimmed.startsWith('[')
    ? trimmed.slice(1, trimmed.indexOf(']'))
    : trimmed.replace(/^::ffff:/, '').replace(/:\d+$/, '');
  return isIP(withoutPort) ? withoutPort : undefined;
}

function forwardedForCandidates(req: Request) {
  return headerValue(req.headers['x-forwarded-for'])
    ?.split(',')
    .map((item) => cleanIp(item))
    .filter((item): item is string => Boolean(item)) ?? [];
}

function forwardedHeaderCandidates(req: Request) {
  return headerValue(req.headers.forwarded)
    ?.split(',')
    .flatMap((part) => part.split(';'))
    .map((segment) => segment.trim())
    .filter((segment) => segment.toLowerCase().startsWith('for='))
    .map((segment) => cleanIp(segment.slice(4).replace(/^"|"$/g, '')))
    .filter((item): item is string => Boolean(item)) ?? [];
}

function isPrivateIp(ip: string) {
  if (ip === '::1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true;
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [first, second] = parts;
  return first === 10
    || first === 127
    || first === 0
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function clientIp(req: Request) {
  const candidates = [
    ...forwardedForCandidates(req),
    ...forwardedHeaderCandidates(req),
    cleanIp(headerValue(req.headers['x-real-ip'])),
    cleanIp(req.ip),
    cleanIp(req.socket.remoteAddress)
  ].filter((item): item is string => Boolean(item));
  return candidates.find((ip) => !isPrivateIp(ip)) ?? candidates[0];
}
