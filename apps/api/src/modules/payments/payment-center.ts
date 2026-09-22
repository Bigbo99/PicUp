import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function centerSign(params: Record<string, string>, key: string) {
  const text = Object.keys(params).filter(name => name !== 'sign' && name !== 'sign_type' && params[name] !== '').sort().map(name => `${name}=${params[name]}`).join('&');
  return createHash('md5').update(text + key).digest('hex');
}

export function centerVerify(params: Record<string, string>, key: string) {
  if (!key || !params.sign) return false;
  const received = Buffer.from(params.sign);
  const expected = Buffer.from(centerSign(params, key));
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function centerConfig() {
  const url = process.env.PAYMENT_CENTER_URL?.trim();
  if (!url) return null;
  const origin = new URL(url);
  const pid = process.env.PAYMENT_CENTER_PID?.trim();
  const key = process.env.PAYMENT_CENTER_KEY?.trim();
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !pid || !key) {
    throw new BadRequestException('支付中心配置不完整，需要 HTTPS 地址、PID 和应用密钥');
  }
  return { origin: origin.origin, pid, key };
}

async function callCenter(path: string, input: Record<string, string>) {
  const config = centerConfig();
  if (!config) throw new BadRequestException('支付中心未配置');
  const params = { ...input, pid: config.pid, sign_type: 'MD5' };
  const response = await fetch(config.origin + path, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, sign: centerSign(params, config.key) }), signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new ServiceUnavailableException('支付中心暂时无法处理订单，请稍后重试');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(value => typeof value !== 'string')) throw new ServiceUnavailableException('支付中心响应无效');
  const result = data as Record<string, string>;
  if (!centerVerify(result, config.key) || result.pid !== config.pid || result.out_trade_no !== input.out_trade_no) throw new ServiceUnavailableException('支付中心响应校验失败');
  return result;
}

export async function createCenterCheckout(id: string, externalOrderId: string, title: string, amountCents: number) {
  const web = new URL(process.env.WEB_PUBLIC_URL ?? '');
  if (web.protocol !== 'https:' || web.username || web.password) throw new BadRequestException('支付回调需要 HTTPS 的 WEB_PUBLIC_URL');
  const money = (amountCents / 100).toFixed(2);
  const result = await callCenter('/api/checkout/orders', {
    type: 'wxpay', out_trade_no: externalOrderId, name: title, money,
    notify_url: `${web.origin}/api/payments/center/notify`,
    return_url: `${web.origin}/?view=payment&order=${encodeURIComponent(id)}`
  });
  const checkout = new URL(result.checkout_url);
  if (result.money !== money || checkout.origin !== centerConfig()!.origin || !checkout.pathname.startsWith('/checkout/') || checkout.username || checkout.password) throw new ServiceUnavailableException('支付中心订单校验失败');
  return result.checkout_url;
}

export async function queryCenterOrder(externalOrderId: string) {
  const nonce = randomBytes(24).toString('hex');
  const result = await callCenter('/api/checkout/query', { out_trade_no: externalOrderId, nonce });
  if (result.nonce !== nonce) throw new ServiceUnavailableException('支付中心查询校验失败');
  return result;
}
