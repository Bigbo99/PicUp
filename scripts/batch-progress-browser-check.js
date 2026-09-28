async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const base = 'http://127.0.0.1:3001';
  const model = { provider: 'progress-check', model: 'gpt-image-2.5-sunburst', enabled: true,
    supportedRatios: ['auto', '1:1'], supportedQualities: ['1K', '2K', '4K'], maxInputImages: 6, costCredits: 5 };
  let theme = 'light';
  let job;
  const references = [];
  const image = index => ({ url: `${base}/api/image/jobs/${job.id}/preview/${index}`, mimeType: 'image/png', width: 1024, height: 1024 });
  const makeJob = (count, suffix) => ({ id: `00000000-0000-4000-8000-${suffix}`, userId: 'progress-user',
    provider: model.provider, selectedProvider: model.provider, model: model.model, selectedModel: model.model,
    status: 'running', mode: 'generate', prompt: '制作一组产品展示图', finalPrompt: 'mock', quality: '2K', aspectRatio: '1:1', count,
    inputFiles: [], imageIds: [], outputImages: [], outputProgress: Array.from({ length: count }, () => ({ status: 'queued' })),
    textOutputs: [], error: null, creditsReserved: count * 5, createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z' });
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (/\/preview\/\d+$|\/content$/.test(path)) return route.fulfill({ path: 'apps/web/public/brand/picup-icon.png', contentType: 'image/png' });
    if (path === '/api/auth/me') return json({ user: { id: 'progress-user', role: 'user', isGuest: false }, credits: { balance: 200, rechargePlans: [] }, quota: { remaining: 0 } });
    if (path === '/api/models') return json({ source: 'runtime', models: [model], defaultProvider: model.provider, defaultModel: model.model });
    if (path === '/api/studio/preferences') return json({ theme, provider: model.provider, model: model.model, quality: '2K', aspectRatio: '1:1' });
    if (path.endsWith('/quote')) return json({ available: true, credits: 5 * (route.request().postDataJSON().count ?? 1), paymentMode: 'credits' });
    const reference = path.match(/\/reference\/(\d+)$/);
    if (reference) {
      references.push(Number(reference[1]));
      return json({ id: '10000000-0000-4000-8000-000000000001', url: 'mock', mimeType: 'image/png', size: 100 });
    }
    if (job && path === `/api/image/jobs/${job.id}`) return json(job);
    if (path === '/api/image/jobs' && route.request().method() === 'POST') throw Error('Progress check must not generate images');
    return json({ items: [] });
  });
  const assert = (value, message) => { if (!value) throw Error(message); };
  const waitStates = async statuses => page.waitForFunction(expected => {
    const slots = [...document.querySelectorAll('.canvas-batch-slot')];
    return slots.length === expected.length && slots.every((slot, index) => slot.getAttribute('data-status') === expected[index]);
  }, statuses);
  const boxes = () => page.locator('.canvas-batch-slot').evaluateAll(slots => slots.map(slot => {
    const box = slot.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  const fits = async () => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflows horizontally');
    assert(await page.locator('.canvas-batch-slot').evaluateAll(slots => slots.every(slot => {
      const box = slot.getBoundingClientRect();
      return box.x >= 0 && box.right <= innerWidth && box.width > 100 && slot.scrollWidth <= slot.clientWidth + 1;
    })), 'Result slots overflow or are too narrow');
  };
  for (const width of [1440, 390, 320]) {
    theme = width === 1440 ? 'dark' : 'light';
    job = makeJob(3, String(width).padStart(12, '0'));
    await page.setViewportSize({ width, height: width === 320 ? 720 : 900 });
    await page.goto(`${base}/?job=${job.id}`);
    await waitStates(['queued', 'queued', 'queued']);
    await fits();
    const original = await boxes();
    job.outputProgress = [{ status: 'running' }, { status: 'running' }, { status: 'running' }];
    await waitStates(['running', 'running', 'running']);
    job.outputImages = [image(0)];
    job.outputProgress[2] = { status: 'succeeded', outputIndex: 0 };
    await waitStates(['running', 'running', 'succeeded']);
    const completed = await boxes();
    assert(original.every((box, index) => Object.keys(box).every(key => Math.abs(box[key] - completed[index][key]) < 1)), 'Grid shifted as an image completed');
    assert(await page.getByRole('button', { name: '继续编辑结果 3', exact: true }).isDisabled(), 'Unfinished batch must not create an invalid parent');
    await page.waitForFunction(() => [...document.querySelectorAll('.canvas-batch-preview img')].every(image => image.complete && image.naturalWidth));
    await page.screenshot({ path: `output/playwright/batch-progress-${width}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '预览结果 3', exact: true }).click();
    await page.getByRole('button', { name: '关闭预览', exact: true }).waitFor();
    assert(await page.locator('.image-viewer-stage > img').getAttribute('src') === `/api/image/jobs/${job.id}/preview/0`, 'Out-of-order preview points to the wrong image');
    assert(await page.locator('.image-viewer > header > span').textContent() === '结果 3', 'Preview lost original slot number');
    await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    await page.reload();
    await waitStates(['running', 'running', 'succeeded']);
    job.outputImages.push(image(1));
    job.outputProgress[0] = { status: 'failed' };
    job.outputProgress[1] = { status: 'succeeded', outputIndex: 1 };
    job.status = 'succeeded';
    job.error = { code: 'BATCH_PARTIAL_FAILURE', message: 'One image failed' };
    job.creditsRefunded = 5;
    await waitStates(['failed', 'succeeded', 'succeeded']);
    await page.getByRole('status').filter({ hasText: '已生成 2/3 张，1 张未完成，已退回 5 积分' }).waitFor();
    await fits();
    await page.getByRole('button', { name: '继续编辑结果 3', exact: true }).click();
    await page.getByRole('button', { name: '管理参考图，共 1 张', exact: true }).waitFor();
    assert(references.at(-1) === 0, 'Continue-editing must use the completed output index');
    await page.screenshot({ path: `output/playwright/batch-progress-finished-${width}.png`, animations: 'disabled' });
  }
  for (const count of [2, 4]) {
    job = makeJob(count, String(count).padStart(12, '0'));
    await page.goto(`${base}/?job=${job.id}`);
    await waitStates(Array(count).fill('queued'));
    await fits();
  }
  return { passed: true, counts: [2, 3, 4], widths: [1440, 390, 320], stableLayout: true, earlyPreview: true, restoredProgress: true, partialFailure: true };
}
