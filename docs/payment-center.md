# PayingPage payment center

PicUp delegates new recharge and single-job payments to PayingPage when
`PAYMENT_CENTER_URL` is configured. Existing Native orders keep the original
query and notification flow. With the center disabled, new orders also use
Native. The previous unshipped PicUp-local JSAPI implementation has been removed.
Only PayingPage holds the service account AppSecret and invokes JSAPI.

## Configuration

In PayingPage's existing application/site admin, register a separate site:

- Name: PicUp; a new PID and independently generated high-entropy application key.
- Site origin: `https://picup.ai-mendao.xyz`
- Enabled channel: `wxpay`
- Notify path allowlist: `/api/payments/center/notify`
- Return path allowlist: `/`

Set these on the PicUp server (never put the key in frontend variables):

```dotenv
WEB_PUBLIC_URL=https://picup.ai-mendao.xyz
PAYMENT_CENTER_URL=https://pay.ai-mendao.com
PAYMENT_CENTER_PID=<PicUp site PID>
PAYMENT_CENTER_KEY=<PicUp site key>
```

PayingPage additionally needs `WECHAT_PAY_APP_SECRET` matching its configured
`WECHAT_PAY_APPID`, and its existing API v3 merchant certificate, private key,
API v3 key, and platform verification key. PicUp's v2 API key is NOT a replacement
for PayingPage's API v3 credentials. The AppID must be merchant-bound.

Official-account web authorization domain: `pay.ai-mendao.com`.
Merchant JSAPI payment authorization directory:
`https://pay.ai-mendao.com/checkout/`.
Publish the official-account verification file on the pay host as requested by
the platform. The previously configured PicUp authorization directory alone is
not sufficient after this migration.

Route `/checkout/`, `/api/checkout/`, and `/payments/wechat/notify` on the pay host
to PayingPage's backend, preserving query strings and cookies. For example,
inside the existing HTTPS server block (substitute the actual backend address):

```nginx
location ^~ /checkout/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ^~ /api/checkout/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Keep the existing official notification route. Install PayingPage's updated
requirements, including `qrcode[pil]`. Deploy PayingPage before enabling the
PicUp center configuration. Back up the PayingPage SQLite database first:
startup migrates the old globally unique order number to `(pid, out_trade_no)`.
Its existing store caches database data in process memory, so run ONE backend
worker/instance; multi-worker deployment needs a separate storage refactor.

## Contract and behavior

- PicUp saves its local order before sending a signed JSON request to
  `POST /api/checkout/orders`. Fields use the existing Epay MD5 signing rule.
- The center returns a signed checkout URL; it is an order-scoped capability
  expiring two hours after creation, not a login or application API key.
- On desktop PicUp shows a QR containing this HTTPS checkout URL. In WeChat,
  recharge opens the cashier directly. The cashier uses service-account OAuth
  and JSAPI. Scanning/recognizing a QR opens the same cashier; actual WeChat
  recognition remains subject to client/platform restrictions.
- In a system browser the cashier displays the webpage QR; H5 app switching is
  not implemented. Existing PayingPage Native/Alipay endpoints are unchanged.
- The center verifies the official notification and exact amount, then sends
  Epay-signed form data to PicUp. PicUp validates PID, channel, order, amount and
  signature and uses its existing database transaction for once-only crediting.
- `POST /api/checkout/query` provides a signed response including the caller's
  nonce. This recovers settlement when PicUp's notification temporarily fails.
  Callback failures return errors to WeChat to trigger its retries; PayingPage's
  existing admin retry endpoint remains available. No new background retry worker
  is introduced.
- Browser bridge success and return navigation never grant credits. Returned
  users must still be logged into the account that owns the PicUp order.
- A center outage fails checkout creation rather than silently switching to
  another payment channel. A locally saved order may remain pending after a
  failed request; creating a new checkout requires retrying recharge.

## Verification and rollout

Run PicUp `pnpm typecheck` and its payment-center unit tests. Run all PayingPage
backend tests, including shared checkout, RSA signing, amount verification,
OAuth state rejection, application isolation, and SQLite migration tests.

Before production acceptance, test on the real HTTPS pay host inside WeChat:
new recharge, cancellation and retry, valid payment, callback/credit arrival,
duplicate notifications, returning to PicUp, and desktop scan/phone long press.
Do not confuse mock bridge tests with a real merchant payment.
