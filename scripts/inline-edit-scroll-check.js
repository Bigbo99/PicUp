async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const now = new Date().toISOString();
  const jobs = Array.from({ length: 10 }, (_, index) => ({
    id: `scroll-${index}`, parentJobId: index ? `scroll-${index - 1}` : undefined,
    status: 'succeeded', mode: 'generate', provider: 'test', model: 'test', selectedModel: 'test',
    prompt: index === 4 ? 'A long instruction with several lines. '.repeat(70) : `Message ${index}`,
    inputFiles: [], imageIds: [], outputImages: [{ url: '/brand/picup-icon.png' }], textOutputs: [],
    aspectRatio: 'auto', quality: '1K', createdAt: now, updatedAt: now, error: null
  }));
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (path.includes('/preview/')) return route.fulfill({ path: 'E:/PROJECT/PicUp/apps/web/public/brand/picup-icon.png', contentType: 'image/png' });
    if (path === '/api/auth/me') return json({ user: { id: 'scroll-user', role: 'user', isGuest: false }, credits: { balance: 20, rechargePlans: [] }, quota: { remaining: 1 } });
    if (path === '/api/models') return json({ source: 'runtime', models: [{ provider: 'test', model: 'test', enabled: true, maxInputImages: 6, supportedRatios: ['auto'], supportedQualities: ['1K'], costCredits: 1 }] });
    if (path.endsWith('/quote')) return json({ available: true, credits: 1 });
    if (path.startsWith('/api/image/jobs/')) return json(jobs.find(job => path.endsWith(`/${job.id}`)));
    return json({});
  });
  const reports = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://127.0.0.1:3001/?job=scroll-9');
    const message = page.locator('[data-message-id="scroll-4"]');
    await message.waitFor();
    await page.locator('.chat-prior-images img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    await message.evaluate(el => {
      const container = el.closest('.chat-conversation');
      container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - 60;
    });
    const before = await message.boundingBox();
    await message.hover();
    await message.getByRole('button', { name: '编辑这条消息' }).click();
    await message.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    const after = await message.boundingBox();
    if (Math.abs(before.y - after.y) > 3) throw Error(`Opening moved message: ${width}, ${before.y} -> ${after.y}`);
    const checkVisible = async () => {
      const values = await page.locator('.chat-inline-editor').evaluate(el => {
        const form = el.getBoundingClientRect();
        const container = el.closest('.chat-conversation').getBoundingClientRect();
        const textarea = el.querySelector('textarea');
        return { top: form.top, bottom: form.bottom, viewportTop: container.top, viewportBottom: container.bottom, focused: document.activeElement === textarea };
      });
      if (values.top < values.viewportTop - 2 || values.bottom > values.viewportBottom + 2 || !values.focused) throw Error(`Editor not visible: ${JSON.stringify(values)}`);
    };
    await checkVisible();
    await page.setViewportSize({ width, height: 600 });
    await page.waitForFunction(() => {
      const el = document.querySelector('.chat-inline-editor');
      const bounds = el.getBoundingClientRect();
      const viewport = el.closest('.chat-conversation').getBoundingClientRect();
      return bounds.top >= viewport.top - 2 && bounds.bottom <= viewport.bottom + 2;
    });
    await checkVisible();
    await page.screenshot({ path: `output/playwright/inline-edit-scroll-${width}.png` });
    const cancelBefore = await message.boundingBox();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    const cancelAfter = await message.boundingBox();
    if (Math.abs(cancelBefore.y - cancelAfter.y) > 3) throw Error('Cancel moved the message');
    reports.push({ width, openShift: after.y - before.y, cancelShift: cancelAfter.y - cancelBefore.y });
  }
  return { passed: true, reports };
}
