async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const base = 'http://127.0.0.1:3001';
  const models = ['gpt-image-2.5-sunburst', 'nano-banana-2'].map((model, i) => ({ model,
    provider: i ? 'other' : 'native', providerType: i ? 'grsai' : 'openai-images', enabled: true,
    supportedRatios: ['auto', '1:1', '16:9'], supportedQualities: ['1K', '2K', '4K'], maxInputImages: 6, costCredits: 5 }));
  const submitted = [];
  const quotes = [];
  const jobs = new Map();
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (/\/preview\/\d+$|\/content$/.test(path)) return route.fulfill({ path: 'apps/web/public/brand/picup-icon.png', contentType: 'image/png' });
    if (path === '/api/auth/me') return json({ user: { id: 'custom-size-user', role: 'user', isGuest: false }, credits: { balance: 200, rechargePlans: [] }, quota: { remaining: 0 } });
    if (path === '/api/models') return json({ source: 'runtime', models, defaultProvider: 'native', defaultModel: models[0].model });
    if (path === '/api/studio/preferences') return json({ theme: 'light', provider: 'native', model: models[0].model, quality: '1K', aspectRatio: '1:1' });
    if (path.endsWith('/quote')) {
      const input = route.request().postDataJSON(); quotes.push(input);
      return json({ available: true, credits: 5 * (input.count ?? 1), paymentMode: 'credits' });
    }
    if (path === '/api/image/jobs' && route.request().method() === 'POST') {
      const input = route.request().postDataJSON(); submitted.push(input);
      const id = `00000000-0000-4000-8000-${String(submitted.length).padStart(12, '0')}`;
      jobs.set(id, { ...input, id, userId: 'custom-size-user', selectedProvider: input.provider, selectedModel: input.model,
        status: 'succeeded', finalPrompt: '', inputFiles: [], textOutputs: [], error: null,
        outputImages: Array.from({ length: input.count }, () => ({ url: 'mock', mimeType: 'image/png', width: input.width, height: input.height })),
        creditsReserved: 15, createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z' });
      return json({ jobId: id, status: 'queued', creditsReserved: 15 });
    }
    if (path.includes('/reference/')) return json({ id: '10000000-0000-4000-8000-000000000001', url: 'mock', mimeType: 'image/png', size: 100 });
    const match = path.match(/^\/api\/image\/jobs\/([^/]+)$/);
    if (match && jobs.has(match[1])) return json(jobs.get(match[1]));
    return json({ items: [] });
  });
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const open = async () => {
    await page.getByRole('button', { name: '比例与清晰度', exact: true }).click();
    await page.getByRole('dialog', { name: '生成设置', exact: true }).waitFor();
  };
  const widthInput = page.getByRole('spinbutton', { name: '输出宽度', exact: true });
  const heightInput = page.getByRole('spinbutton', { name: '输出高度', exact: true });
  const values = async (w, h) => page.waitForFunction(([width, height]) =>
    document.querySelector('[aria-label="输出宽度"]')?.value === width
    && document.querySelector('[aria-label="输出高度"]')?.value === height, [String(w), String(h)]);
  const commit = async () => page.getByText('尺寸', { exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await page.evaluate(() => sessionStorage.clear()); await page.reload();
    await open(); await values(1024, 1024);
    await widthInput.fill('2048'); await commit(); await values(2048, 2048);
    await page.getByRole('button', { name: '锁定宽高比例', exact: true }).click();
    await widthInput.fill('1600'); await commit();
    await heightInput.fill('1024'); await commit(); await values(1600, 1024);
    await widthInput.fill('1000'); await commit();
    assert(await widthInput.getAttribute('aria-invalid') === 'true', 'Invalid size has no inline error');
    assert(await page.getByRole('button', { name: '完成', exact: true }).isDisabled(), 'Invalid size accepted');
    await widthInput.fill('1600'); await commit();
    await page.getByRole('button', { name: '3 张', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.quote-label')?.textContent === '15 积分');
    assert(quotes.at(-1).width === 1600 && quotes.at(-1).height === 1024 && quotes.at(-1).quality === '2K', 'Quote did not receive custom size');
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Settings overflow');
    await page.screenshot({ path: `output/playwright/custom-size-${width}.png` });
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.reload(); await open(); await values(1600, 1024);
    assert(await page.getByRole('button', { name: '2K', exact: true }).getAttribute('aria-pressed') === 'true', 'Reload replaced custom resolution with defaults');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.locator('#studio-prompt').fill('Custom dimensions test');
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await page.locator('.canvas-batch-preview').first().waitFor();
    const input = submitted.at(-1);
    assert(input.width === 1600 && input.height === 1024 && input.quality === '2K' && input.aspectRatio === '25:16' && input.count === 3, 'Batch omitted custom dimensions');
    assert((await page.locator('.studio-canvas .canvas-image-meta').textContent()).includes('1600 × 1024'), 'Result parameters lost dimensions');
    await page.getByRole('button', { name: '继续编辑结果 2', exact: true }).click();
    await page.getByRole('button', { name: '管理参考图，共 1 张', exact: true }).waitFor();
    await open(); await values(1600, 1024);
    await page.getByRole('button', { name: '16:9', exact: true }).click(); await values(2048, 1152);
    await page.waitForFunction(() => document.querySelector('.quote-label')?.textContent === '5 积分');
    assert(quotes.at(-1).width === undefined && quotes.at(-1).height === undefined, 'Preset kept stale dimensions');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
    await page.getByRole('button', { name: 'Nano Banana 2', exact: true }).click();
    await open();
    assert(await widthInput.isDisabled() && await heightInput.isDisabled(), 'Unsupported provider must not accept ignored dimensions');
    await page.getByText('此模型按比例和清晰度生成；自定义像素请选择 GPT Image 2 / 2.5。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '完成', exact: true }).click();
  }
  return { passed: true, widths: [1440, 390], submitted: submitted.map(({ width, height, quality, count }) => ({ width, height, quality, count })), locking: true, validation: true, persisted: true, continued: true };
}
