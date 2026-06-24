import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthUser, CreditRechargePlan } from '@picup/shared';
import { StorageService } from '../../common/storage.service';
import { singleUsePriceCents } from '../auth/auth.service';

const paymentRechargePlans: CreditRechargePlan[] = [
  // { id: 'credits_10_trial', title: '10 积分', amountCents: 10, credits: 10 },
  { id: 'credits_20', title: '20 积分', amountCents: 990, credits: 20 },
  { id: 'credits_45', title: '45 积分', amountCents: 1990, credits: 45 }
];

@Injectable()
export class PaymentsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  plans() {
    return { plans: paymentRechargePlans };
  }

  async getOrder(id: string, userId: string) {
    const order = await this.storage.getPaymentOrder(id, userId);
    if (!order) throw new NotFoundException('支付订单不存在');
    if (order.status === 'paid' || !order.id) return order;

    const queryResult = await this.queryWechatOrder(order.id).catch((error) => {
      console.warn(`[payment] query order failed id=${order.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (!queryResult) return order;

    if (queryResult.return_code === 'SUCCESS' && queryResult.result_code === 'SUCCESS' && queryResult.trade_state === 'SUCCESS') {
      const paid = await this.storage.markPaymentOrderPaid(queryResult.out_trade_no);
      return paid ?? order;
    }

    return order;
  }

  async createRechargeOrder(user: AuthUser, planId: CreditRechargePlan['id']) {
    const plan = paymentRechargePlans.find((item) => item.id === planId);
    if (!plan) throw new BadRequestException(`充值套餐不存在：${planId}`);

    const id = randomUUID();
    const externalOrderId = `RC${Date.now()}${randomBytes(4).toString('hex')}`;
    const codeUrl = await this.createWechatNativeOrder({
      outTradeNo: externalOrderId,
      body: `PicUp ${plan.title}`,
      amountCents: plan.amountCents,
      attach: id
    });

    return this.storage.createPaymentOrder({
      id,
      userId: user.id,
      externalOrderId,
      orderType: 'credit_recharge',
      amountCents: plan.amountCents,
      credits: plan.credits,
      metadata: { planId, codeUrl }
    });
  }

  async createSingleJobOrder(user: AuthUser) {
    const id = randomUUID();
    const externalOrderId = `SJ${Date.now()}${randomBytes(4).toString('hex')}`;
    const codeUrl = await this.createWechatNativeOrder({
      outTradeNo: externalOrderId,
      body: 'PicUp single image generation',
      amountCents: singleUsePriceCents,
      attach: id
    });

    return this.storage.createPaymentOrder({
      id,
      userId: user.id,
      externalOrderId,
      orderType: 'single_job',
      amountCents: singleUsePriceCents,
      credits: 0,
      metadata: { codeUrl }
    });
  }

  async handleWechatNotify(rawBody: string, _contentType?: string) {
    const payload = this.parseXml(rawBody);
    if (!this.verifyWechatSign(payload)) {
      return this.wechatXmlResponse('FAIL', 'invalid sign');
    }

    if (payload.return_code !== 'SUCCESS' || payload.result_code !== 'SUCCESS') {
      return this.wechatXmlResponse('SUCCESS', 'ignored');
    }

    await this.storage.markPaymentOrderPaid(payload.out_trade_no);
    return this.wechatXmlResponse('SUCCESS', 'OK');
  }

  private async createWechatNativeOrder(input: {
    outTradeNo: string;
    body: string;
    amountCents: number;
    attach: string;
  }) {
    const appid = this.env('WECHAT_PAY_APPID');
    const mchId = this.env('WECHAT_PAY_MCH_ID');
    const notifyUrl = this.env('WECHAT_PAY_NOTIFY_URL');
    const apiKey = this.env('WECHAT_PAY_API_KEY');
    if (!appid || !mchId || !notifyUrl || !apiKey) {
      throw new BadRequestException('微信支付未配置，请检查 WECHAT_PAY_APPID、WECHAT_PAY_MCH_ID、WECHAT_PAY_API_KEY、WECHAT_PAY_NOTIFY_URL');
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(notifyUrl)) {
      throw new BadRequestException('WECHAT_PAY_NOTIFY_URL 不能使用 localhost，请配置微信支付可访问的公网 HTTPS 回调地址');
    }

    const params: Record<string, string> = {
      appid,
      mch_id: mchId,
      nonce_str: randomBytes(16).toString('hex'),
      body: input.body,
      out_trade_no: input.outTradeNo,
      total_fee: String(input.amountCents),
      spbill_create_ip: process.env.WECHAT_PAY_CLIENT_IP || '127.0.0.1',
      notify_url: notifyUrl,
      trade_type: 'NATIVE',
      attach: input.attach
    };
    params.sign = this.wechatSign(params);

    const response = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: this.toXml(params)
    }).catch((error) => {
      throw new ServiceUnavailableException(`微信支付下单失败：${error instanceof Error ? error.message : String(error)}`);
    });

    const text = await response.text();
    const result = this.parseXml(text);
    if (result.return_code !== 'SUCCESS' || result.result_code !== 'SUCCESS' || !result.code_url) {
      throw new ServiceUnavailableException(this.wechatErrorMessage(result, text));
    }
    return result.code_url;
  }

  private async queryWechatOrder(orderId: string) {
    const order = await this.storage.getPaymentOrder(orderId);
    if (!order) return null;
    const externalOrderId = await this.storage.getPaymentOrderExternalId(orderId);
    if (!externalOrderId) return null;

    const appid = this.env('WECHAT_PAY_APPID');
    const mchId = this.env('WECHAT_PAY_MCH_ID');
    const apiKey = this.env('WECHAT_PAY_API_KEY');
    if (!appid || !mchId || !apiKey) return null;

    const params: Record<string, string> = {
      appid,
      mch_id: mchId,
      out_trade_no: externalOrderId,
      nonce_str: randomBytes(16).toString('hex')
    };
    params.sign = this.wechatSign(params);

    const response = await fetch('https://api.mch.weixin.qq.com/pay/orderquery', {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: this.toXml(params)
    });
    return this.parseXml(await response.text());
  }

  private wechatErrorMessage(result: Record<string, string>, raw: string) {
    const details = [
      result.return_msg,
      result.err_code,
      result.err_code_des
    ].filter(Boolean);
    return details.length > 0 ? `微信支付下单失败：${details.join(' / ')}` : `微信支付下单失败：${raw.slice(0, 500)}`;
  }

  private env(name: string) {
    return process.env[name]?.trim().replace(/^"(.*)"$/, '$1') ?? '';
  }

  private verifyWechatSign(payload: Record<string, string>) {
    return Boolean(payload.sign) && this.wechatSign(payload) === payload.sign;
  }

  private wechatSign(params: Record<string, string>) {
    const apiKey = this.env('WECHAT_PAY_API_KEY');
    const query = Object.keys(params)
      .filter((key) => key !== 'sign' && params[key] !== '')
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return createHash('md5').update(`${query}&key=${apiKey}`, 'utf8').digest('hex').toUpperCase();
  }

  private parseXml(xml: string) {
    const result: Record<string, string> = {};
    const body = xml.trim().replace(/^<xml>/i, '').replace(/<\/xml>$/i, '').trim();
    const tagPattern = /<([A-Za-z0-9_:-]+)>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/\1>/g;
    for (const match of body.matchAll(tagPattern)) {
      result[match[1]] = (match[2] ?? match[3] ?? '').trim();
    }
    return result;
  }

  private toXml(params: Record<string, string>) {
    return `<xml>${Object.entries(params).map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`).join('')}</xml>`;
  }

  private wechatXmlResponse(code: 'SUCCESS' | 'FAIL', message: string) {
    return this.toXml({ return_code: code, return_msg: message });
  }
}
