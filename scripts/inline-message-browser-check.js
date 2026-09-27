async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const requests = [];
  const now = new Date().toISOString();
  const file = { id: 'reference', hash: 'e2547b5a8c59d734b6f27247cc9ea2653c2a266a75ddc3fd69910bbec8672563', url: '/brand/picup-icon.png', mimeType: 'image/png', size: 100, createdAt: now };
  const root = { id: 'root', status: 'succeeded', mode: 'edit', provider: 'test', model: 'test', template: 'auto', prompt: 'Original instruction', inputFiles: [file], imageIds: [file.id], outputImages: [{ url: file.url }], textOutputs: [], aspectRatio: 'auto', quality: '1K', error: null, createdAt: now, updatedAt: now };
  const upload = { ...file, id: 'new-upload', hash: 'different-content' };
  const child = { ...root, id: 'child', parentJobId: 'root', prompt: 'Later instruction', inputFiles: [file, upload], imageIds: [file.id, upload.id] };
  let fail = true;
  await page.route('**/api/**', async route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (path.endsWith('/content') || path.includes('/preview/')) return route.fulfill({ path: 'E:/PROJECT/PicUp/apps/web/public/brand/picup-icon.png', contentType: 'image/png' });
    if (path === '/api/auth/me') return json({ user: { id: 'test-user', role: 'user', isGuest: false }, credits: { balance: 20, rechargePlans: [] }, quota: { remaining: 1 } });
    if (path === '/api/models') return json({ source: 'runtime', models: [{ provider: 'test', model: 'test', enabled: true, maxInputImages: 6, supportedRatios: ['auto'], supportedQualities: ['1K'], costCredits: 1 }] });
    if (path.endsWith('/quote')) return json({ available: true, credits: 1, paymentMode: 'credits' });
    if (path === '/api/image/jobs' && route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      if (fail) { fail = false; return route.fulfill({ status: 500, json: { message: 'Test failure' } }); }
      return json({ jobId: 'replacement' });
    }
    if (path.startsWith('/api/image/jobs/')) return json(path.endsWith('/child') ? child : path.endsWith('/replacement') ? { ...root, id: 'replacement', prompt: 'Revised instruction' } : root);
    if (path.endsWith('/preferences')) return json({});
    return json({ items: [] });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:3001/?job=child');
  const first = page.locator('.chat-user-message').first();
  await first.waitFor();
  await page.locator('.chat-attachment.is-reference').waitFor();
  const sizes = await page.locator('.chat-attachment button').evaluateAll(elements => elements.map(el => ({ width: el.clientWidth, height: el.clientHeight, referenced: el.parentElement.classList.contains('is-reference'), fit: getComputedStyle(el.querySelector('img')).objectFit })));
  if (sizes.length !== 3 || sizes.some(item => item.width !== item.height || item.fit !== 'cover') || sizes.filter(item => item.referenced).length !== 1 || sizes[0].width !== sizes[2].width || sizes[1].width >= sizes[0].width) throw Error('Incorrect upload or reference thumbnail layout');
  await page.mouse.move(0, 0);
  if (await first.locator('.message-prompt-edit').evaluate(el => getComputedStyle(el).opacity) !== '0') throw Error('Desktop tools should be hidden');
  await first.hover();
  await first.getByRole('button', { name: '编辑这条消息' }).click();
  await page.getByRole('textbox', { name: '编辑消息', exact: true }).fill('Cancelled instruction');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  if (requests.length) throw Error('Cancel submitted a request');
  await first.hover();
  await first.getByRole('button', { name: '编辑这条消息' }).click();
  await page.getByRole('textbox', { name: '编辑消息', exact: true }).fill('Revised instruction');
  await page.locator('.chat-inline-editor img').evaluate(img => img.decode());
  await page.screenshot({ path: 'output/playwright/inline-message-desktop.png' });
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.locator('.chat-inline-editor [role="alert"]').waitFor();
  if (await page.getByRole('textbox', { name: '编辑消息', exact: true }).inputValue() !== 'Revised instruction') throw Error('Failure lost draft');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForURL('**job=replacement');
  if (requests.length !== 2 || requests.some(r => r.parentJobId || r.prompt !== 'Revised instruction' || r.imageIds[0] !== 'reference')) throw Error('Wrong branch or attachments');
  if (requests[0].idempotencyKey !== requests[1].idempotencyKey) throw Error('Retry changed request key');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:3001/?job=child');
  await page.locator('.chat-user-message[data-reference="true"]').waitFor();
  await page.locator('.chat-attachment.is-reference').waitFor();
  await page.locator('.chat-input-images img').first().evaluate(img => img.decode());
  await page.screenshot({ path: 'output/playwright/inline-message-mobile.png' });
  if (await page.locator('.message-prompt-edit').first().evaluate(el => getComputedStyle(el).opacity) !== '1') throw Error('Mobile tools hidden');
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Horizontal overflow');
  return { passed: true, checks: ['cancel', 'failure retains draft', 'retry key', 'root branch', 'attachments', 'desktop hover', 'mobile tools', 'mobile overflow'] };
}
