import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import type { AuthUser, PaymentOrderResponse } from '@picup/shared';
import type { StorageService } from '../../common/storage.service';
import { PaymentsService } from './payments.service';
import { centerSign, centerVerify, createCenterCheckout, queryCenterOrder } from './payment-center';

const env = { PAYMENT_CENTER_URL: 'https://pay.test', PAYMENT_CENTER_PID: 'picup', PAYMENT_CENTER_KEY: 'test-key', WEB_PUBLIC_URL: 'https://picup.test' };
const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
before(() => Object.assign(process.env, env));
after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

it('signs requests and verifies center origin, amount, order and signature', async t => {
  let override: Record<string, string> = {};
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    assert.equal(url, 'https://pay.test/api/checkout/orders');
    const input = JSON.parse(String(init?.body));
    assert.ok(centerVerify(input, 'test-key'));
    assert.equal(input.notify_url, 'https://picup.test/api/payments/center/notify');
    assert.equal(input.money, '9.90');
    const result = { pid: 'picup', out_trade_no: 'RC001', trade_no: 'PAY001', money: '9.90', checkout_url: 'https://pay.test/checkout/PAY001?token=test', ...override };
    return Response.json({ ...result, sign: centerSign(result, 'test-key') });
  });
  assert.match(await createCenterCheckout('local', 'RC001', 'credits', 990), /^https:\/\/pay.test\/checkout/);
  const invalid: Record<string, string>[] = [{ money: '1.00' }, { pid: 'another' }, { out_trade_no: 'RC002' }, { checkout_url: 'https://evil.test/checkout/PAY001' }];
  for (const bad of invalid) {
    override = bad;
    await assert.rejects(createCenterCheckout('local', 'RC001', 'credits', 990));
  }
});

it('rejects replayed query responses with a different nonce', async t => {
  t.mock.method(globalThis, 'fetch', async () => {
    const result = { pid: 'picup', out_trade_no: 'RC001', money: '9.90', status: 'paid', nonce: 'stale' };
    return Response.json({ ...result, sign: centerSign(result, 'test-key') });
  });
  await assert.rejects(queryCenterOrder('RC001'));
});

it('accepts only signed matching center notifications and preserves idempotent crediting', async () => {
  let credited = false;
  let balance = 0;
  const order = { id: 'local', paymentProvider: 'payingpage', amountCents: 990 } as PaymentOrderResponse;
  const service = new PaymentsService({
    getPaymentOrderByExternalId: async (id: string) => id === 'RC001' ? order : null,
    markPaymentOrderPaid: async () => { if (!credited) { balance += 20; credited = true; } return order; }
  } as unknown as StorageService);
  const data = { pid: 'picup', type: 'wxpay', out_trade_no: 'RC001', trade_no: 'PAY001', money: '9.90', trade_status: 'TRADE_SUCCESS' };
  const signed = (input: Record<string, string>) => ({ ...input, sign: centerSign(input, 'test-key') });
  assert.equal(await service.handleCenterNotify({ ...signed(data), money: '0.01' }), 'fail');
  assert.equal(await service.handleCenterNotify(signed({ ...data, pid: 'other' })), 'fail');
  assert.equal(await service.handleCenterNotify(signed({ ...data, money: '0.01' })), 'fail');
  assert.equal(await service.handleCenterNotify(signed({ ...data, out_trade_no: 'other' })), 'fail');
  assert.equal(balance, 0);
  assert.equal(await service.handleCenterNotify(signed(data)), 'success');
  assert.equal(await service.handleCenterNotify(signed(data)), 'success');
  assert.equal(balance, 20);
});

it('persists the PicUp order before creating a remote checkout', async t => {
  let saved: Parameters<StorageService['createPaymentOrder']>[0] | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    assert.ok(saved);
    const input = JSON.parse(String(init?.body));
    assert.equal(input.out_trade_no, saved.externalOrderId);
    const result = { pid: 'picup', out_trade_no: input.out_trade_no, money: input.money, checkout_url: 'https://pay.test/checkout/PAY1?token=test' };
    return Response.json({ ...result, sign: centerSign(result, 'test-key') });
  });
  const service = new PaymentsService({ createPaymentOrder: async (input: Parameters<StorageService['createPaymentOrder']>[0]) => { saved = input; }, setPaymentCheckoutUrl: async (id: string, checkoutUrl: string) => ({ id, checkoutUrl }) } as unknown as StorageService);
  const order = await service.createRechargeOrder({ id: 'user-a' } as AuthUser, 'credits_20');
  assert.ok(order.checkoutUrl);
  assert.equal(saved?.userId, 'user-a');
  assert.equal(saved?.credits, 20);
});
