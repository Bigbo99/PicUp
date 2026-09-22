async (page) => {
  const checks = [];
  const check = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  let legacy = false;
  let paid = false;
  const order = () => ({ id: 'center-order', status: paid ? 'paid' : 'pending', orderType: 'credit_recharge', amountCents: 990, credits: 20,
    ...(legacy ? { codeUrl: 'weixin://wxpay/test' } : { paymentProvider: 'payingpage', checkoutUrl: 'https://pay.test/checkout/test?token=fixture' }), createdAt: new Date().toISOString() });
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (path === '/api/auth/me') return json({ user: { id: 'user-a', email: 'preview@example.test', role: 'user', status: 'active', isGuest: false }, quota: { remaining: 1 }, credits: { balance: paid ? 20 : 0, rechargePlans: [{ id: 'credits_20', title: '20 积分', credits: 20, amountCents: 990 }], singleUsePriceCents: 50 } });
    if (path === '/api/models') return json({ models: [], defaultProvider: 'auto', defaultModel: 'auto' });
    if (path === '/api/studio/preferences') return json({});
    if (path === '/api/image/jobs') return json([]);
    if (path === '/api/payments/activity') return json({ entries: [], orders: [] });
    if (path.startsWith('/api/payments/orders/') || path === '/api/payments/recharge') return json(order());
    return json({ items: [], next: null });
  });
  await page.route('https://pay.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Mock payment center</h1>' }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://localhost:3002/?view=payment&order=center-order');
  const qr = page.getByRole('img', { name: '微信支付二维码' });
  await qr.waitFor();
  check((await qr.getAttribute('src')).startsWith('data:image/png'), 'center order generates a local PNG QR');
  check(await page.getByRole('link', { name: '前往收银台' }).getAttribute('href') === 'https://pay.test/checkout/test?token=fixture', 'cashier link uses the server checkout URL');
  await page.screenshot({ path: 'output/playwright/picup-center-desktop.png' });
  paid = true;
  await page.getByRole('button', { name: '刷新支付状态', exact: true }).click();
  await page.getByRole('button', { name: '确认充值', exact: true }).waitFor();
  check(true, 'confirmed center payment returns to recharge');
  paid = false;
  legacy = true;
  await page.goto('http://localhost:3002/?view=payment&order=center-order');
  await qr.waitFor();
  check(await page.getByRole('link', { name: '前往收银台' }).count() === 0, 'legacy Native order retains QR without center redirect');
  legacy = false;
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'MicroMessenger/8.0' }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3002/?view=recharge');
  await page.getByRole('button', { name: /20.*积分.*选择套餐/ }).click();
  await page.getByRole('button', { name: '确认充值', exact: true }).click();
  await page.waitForURL('https://pay.test/checkout/test?token=fixture');
  check(true, 'WeChat recharge redirects to PayingPage after local order is saved');
  return checks;
}
