async (page) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  await page.setContent('<canvas width="220" height="220"></canvas>');
  const qrImage = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 220, 220);
    ctx.fillStyle = '#111';
    for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) {
      if ((x * 7 + y * 13) % 5 < 3) ctx.fillRect(10 + x * 8, 10 + y * 8, 8, 8);
    }
    return canvas.toDataURL();
  });
  const checks = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let signedIn = false;
  let starts = 0;
  let polls = 0;
  let status = 'pending';
  let failStart = false;
  let expiresIn = 300000;
  let registerBody;
  let loginFailure = '';
  const account = () => ({ user: { id: signedIn ? 'auth-member' : 'auth-guest', email: signedIn ? 'member@example.test' : null, displayName: signedIn ? '测试创作者' : null, isGuest: !signedIn, role: 'user', quotaUnlimited: false, creditBalance: 18 }, quota: { dailyTotal: 1, dailyUsed: 0, remaining: 1 }, credits: { balance: 18, rechargePlans: [], singleUsePriceCents: 50 } });
  await page.route('**/api/**', async route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (path === '/api/auth/me') return json(account());
    if (path === '/api/auth/wechat/start') {
      starts++;
      if (failStart) return route.fulfill({ status: 503, json: { message: '微信服务暂不可用' } });
      return json({ state: `session-${starts}`, qrCodeUrl: qrImage, expiresAt: new Date(Date.now() + expiresIn).toISOString() });
    }
    if (path === '/api/auth/wechat/status') { polls++; if (status === 'confirmed') signedIn = true; return json({ status }); }
    if (path === '/api/auth/login') {
      if (loginFailure === 'network') return route.abort('failed');
      if (loginFailure === 'server') return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>proxy diagnostic private-host</html>' });
      if (loginFailure === 'malformed') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>unexpected response</html>' });
      if (loginFailure === 'credentials') return route.fulfill({ status: 401, json: { message: 'Invalid email or password' } });
      if (loginFailure === 'limit') return route.fulfill({ status: 429, json: { message: 'Too Many Requests' } });
      signedIn = true; return json(account());
    }
    if (path === '/api/auth/email/start') { registerBody = route.request().postDataJSON(); return json({ challengeId: 'email-test', email: registerBody.email, mode: 'register', delivery: 'email', expiresAt: new Date(Date.now() + 600000).toISOString() }); }
    if (path === '/api/auth/email/verify') { signedIn = true; return json(account()); }
    if (path === '/api/studio/preferences') return json({});
    if (path === '/api/studio/assets' || path === '/api/studio/conversations') return json({ items: [], next: null });
    if (path === '/api/payments/activity') return json({ entries: [], orders: [] });
    if (path === '/api/image/jobs') return json([]);
    if (path === '/api/models') return json({ models: [], defaultProvider: 'auto', defaultModel: 'auto' });
    return route.fulfill({ status: 404, json: { message: 'Unknown fixture endpoint' } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://localhost:3001/');
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.reload();
  const prompt = page.getByRole('textbox', { name: '你想创作什么？' });
  await prompt.fill('登录前保留的灵感');
  const accountButton = page.getByRole('button', { name: '登录 / 注册', exact: true });
  const bounds = await accountButton.boundingBox();
  const history = await page.getByRole('button', { name: '对话历史', exact: true }).boundingBox();
  check(bounds.x < 200 && bounds.y > 750 && history.x > 1200 && history.y < 100, 'account bottom left and conversation history top right');
  check(await page.locator('.studio-navigation button').count() === 3, 'navigation contains only creation, gallery and account');
  await accountButton.click();
  await page.getByText('使用微信扫一扫，确认登录').waitFor();
  check(await page.getByRole('button', { name: '微信扫码', exact: true }).getAttribute('aria-pressed') === 'true', 'WeChat is the default login method');
  check(starts === 1, 'opening login creates a single QR session');
  await page.screenshot({ path: 'output/playwright/auth-desktop-light.png' });
  for (const [width, height, theme] of [[390, 844, 'dark'], [320, 568, 'light'], [740, 360, 'dark']]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(theme => document.documentElement.dataset.studioTheme === theme, theme);
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector('dialog').getBoundingClientRect();
      const image = document.querySelector('.wechat-qr-stage img');
      return { overflow: document.documentElement.scrollWidth > innerWidth, visible: dialog.top >= 0 && dialog.bottom <= innerHeight, loaded: image.complete && image.naturalWidth > 0 };
    });
    check(!metrics.overflow && metrics.visible && metrics.loaded, `${width}x${height}: responsive dialog and QR render in ${theme} theme`);
    await page.screenshot({ path: `output/playwright/auth-${width}-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '密码登录', exact: true }).click();
  const stoppedPolls = polls;
  await page.waitForTimeout(2400);
  check(polls === stoppedPolls, 'switching login method stops QR polling');
  for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
  check(await page.evaluate(() => Boolean(document.activeElement.closest('dialog'))), 'login dialog traps keyboard focus');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  check(await page.getByLabel('邮箱', { exact: true }).evaluate(field => field.validationMessage) === '请填写此项后继续。', 'required field validation is Chinese');
  await page.getByLabel('邮箱', { exact: true }).fill('member@example.test');
  await page.getByLabel('密码', { exact: true }).fill('test-password');
  for (const [failure, message] of [['credentials', '邮箱或密码不正确，请检查后重试。'], ['limit', '操作有些频繁，请稍等片刻再试。'], ['server', '服务暂时繁忙，请稍后重试。'], ['network', '网络连接中断，请检查网络后重试。'], ['malformed', '服务返回异常，请稍后重试。']]) {
    loginFailure = failure;
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: message }).waitFor();
    check(true, `${failure}: actionable Chinese feedback replaces raw diagnostics`);
  }
  loginFailure = '';
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check(await page.getByRole('button', { name: '账户与设置', exact: true }).textContent() === '测试创作者已登录', 'password login updates account identity');
  check(await prompt.inputValue() === '登录前保留的灵感', 'login preserves the current creative draft');
  signedIn = false; failStart = true;
  await page.goto('http://localhost:3001/login');
  await page.getByText('二维码加载失败', { exact: true }).waitFor();
  check(await page.evaluate(() => new URL(location.href).searchParams.get('view')) === 'login', 'legacy login URL opens the modal');
  const failedStarts = starts;
  await page.waitForTimeout(2400);
  check(starts === failedStarts, 'QR failure does not create an automatic retry loop');
  failStart = false; expiresIn = 1000;
  await page.getByRole('button', { name: '重新获取', exact: true }).click();
  await page.getByText('二维码已过期', { exact: true }).waitFor();
  check(true, 'expired QR has a clear recovery action');
  expiresIn = 300000;
  await page.getByRole('button', { name: '重新获取', exact: true }).click();
  await page.getByText('使用微信扫一扫，确认登录').waitFor();
  status = 'confirmed';
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check(await page.getByRole('button', { name: '账户与设置', exact: true }).isVisible(), 'server-confirmed QR login updates account and dismisses modal');
  signedIn = false; status = 'pending';
  await page.goto('http://localhost:3001/?view=login');
  await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill('new@example.test');
  await page.getByLabel('密码', { exact: true }).fill('test-password');
  check(await page.getByRole('button', { name: '发送验证码', exact: true }).isDisabled(), 'registration requires explicit agreement');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('123456');
  check(registerBody.email === 'new@example.test' && registerBody.termsAccepted === true, 'registration submits email and agreement');
  await page.getByRole('button', { name: '完成注册并登录', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check(true, 'email verification finishes registration within the modal');
  signedIn = false;
  await page.goto('http://localhost:3001/?view=login');
  await page.getByText('使用微信扫一扫，确认登录').waitFor();
  const dialogBounds = await page.getByRole('dialog').boundingBox();
  await page.mouse.move(dialogBounds.x + 20, dialogBounds.y + 20);
  await page.mouse.down(); await page.mouse.move(2, 2); await page.mouse.up();
  check(await page.getByRole('dialog').isVisible(), 'dragging from inside to outside does not dismiss dialog');
  await page.mouse.click(2, 2);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check(true, 'clicking the backdrop dismisses login');
  const closedPolls = polls;
  await page.waitForTimeout(2400);
  check(polls === closedPolls, 'closing the login modal stops polling');
  check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('http://localhost:3001/');
  return { checks };
}
