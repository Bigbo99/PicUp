async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const baseUrl = 'http://127.0.0.1:3001';
  const userId = 'batch-check-user';
  const unitCredits = 6;
  const requests = [];
  const quotes = [];
  const references = [];
  const jobs = new Map();
  const screenshots = [];
  const imagePath = 'apps/web/public/brand/picup-icon.png';
  const now = '2026-09-28T00:00:00.000Z';
  const model = {
    provider: 'batch-test-provider', model: 'gpt-image-2.5-sunburst', displayName: 'Sunburst',
    enabled: true, supportedRatios: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4'],
    supportedQualities: ['1K', '2K', '4K'], maxInputImages: 6, costCredits: unitCredits
  };
  const output = (id, index) => ({ url: `${baseUrl}/api/image/jobs/${id}/preview/${index}`, mimeType: 'image/png', width: 1024, height: 1024 });
  const makeJob = (id, input, completed = input.count ?? 1) => ({
    ...input, id, userId, count: input.count ?? 1, status: 'succeeded',
    selectedProvider: model.provider, selectedModel: model.model, finalPrompt: input.prompt,
    inputFiles: [], outputImages: Array.from({ length: completed }, (_, index) => output(id, index)),
    textOutputs: [], creditsReserved: unitCredits * (input.count ?? 1), creditsRefunded: 0,
    attempt: 1, createdAt: now, updatedAt: now, completedAt: now
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = '/api/' + request.url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (/\/preview\/\d+$|\/content$/.test(path)) return route.fulfill({ path: imagePath, contentType: 'image/png' });
    if (path === '/api/auth/me') return json({ user: { id: userId, role: 'user', isGuest: false }, credits: { balance: 200, rechargePlans: [] }, quota: { remaining: 0 } });
    if (path === '/api/models') return json({ source: 'runtime', models: [model], defaultProvider: model.provider, defaultModel: model.model });
    if (path === '/api/studio/preferences') return json({ provider: model.provider, model: model.model, aspectRatio: 'auto', quality: '1K' });
    if (path === '/api/image/jobs/quote') {
      const input = request.postDataJSON();
      quotes.push(input);
      return json({ available: true, credits: unitCredits * (input.count ?? 1), selection: `${model.provider}:${model.model}` });
    }
    if (path === '/api/image/jobs' && request.method() === 'POST') {
      const input = request.postDataJSON();
      requests.push(input);
      const id = `00000000-0000-4000-8000-${String(requests.length).padStart(12, '0')}`;
      jobs.set(id, makeJob(id, input));
      return json({ jobId: id, status: 'queued', creditsReserved: unitCredits * (input.count ?? 1) });
    }
    const reference = path.match(/^\/api\/image\/jobs\/([^/]+)\/reference\/(\d+)$/);
    if (reference) {
      references.push({ jobId: reference[1], index: Number(reference[2]) });
      return json({ id: '10000000-0000-4000-8000-000000000001', url: `${baseUrl}/api/files/10000000-0000-4000-8000-000000000001/content`, mimeType: 'image/png', size: 1000, createdAt: now });
    }
    const job = path.match(/^\/api\/image\/jobs\/([^/]+)$/);
    if (job && jobs.has(job[1])) return json(jobs.get(job[1]));
    return json({ items: [], next: null });
  });

  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const openSettings = async () => {
    await page.getByRole('button', { name: '比例与清晰度', exact: true }).click();
    await page.getByRole('group', { name: '生成数量', exact: true }).waitFor();
  };
  const selectCount = async count => {
    const button = page.getByRole('group', { name: '生成数量', exact: true }).getByRole('button', { name: `${count} 张`, exact: true });
    await button.click();
    await page.waitForFunction(({ count, credits }) => {
      const group = [...document.querySelectorAll('fieldset')].find(element => element.querySelector('legend')?.textContent === '生成数量');
      return [...group.querySelectorAll('button')].some(element => element.getAttribute('aria-label') === `${count} 张` && element.getAttribute('aria-pressed') === 'true')
        && document.querySelector('.quote-label')?.textContent === `${credits} 积分`;
    }, { count, credits: unitCredits * count });
  };
  const assertFits = async () => {
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth, document: document.documentElement.scrollWidth,
      groups: [...document.querySelectorAll('fieldset')].map(element => ({ width: element.clientWidth, content: element.scrollWidth }))
    }));
    assert(dimensions.document <= dimensions.viewport, `Horizontal page overflow: ${JSON.stringify(dimensions)}`);
    assert(dimensions.groups.every(group => group.content <= group.width + 1), `Settings overflow: ${JSON.stringify(dimensions)}`);
  };
  const screenshot = async name => {
    const path = `output/playwright/batch-${name}.png`;
    await page.waitForFunction(() => [...document.querySelectorAll('.studio-canvas img')].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path });
    screenshots.push(path);
  };
  const assertParameters = async () => {
    const valid = await page.locator('.chat-turn').evaluateAll(turns => turns.every(turn => {
      const images = turn.querySelector('.canvas-batch-grid, .canvas-stage, .chat-prior-images');
      if (!images) return true;
      const parameters = turn.querySelectorAll('.canvas-image-meta');
      if (parameters.length !== 1 || images.contains(parameters[0])) return false;
      const box = images.getBoundingClientRect();
      const label = parameters[0].getBoundingClientRect();
      return label.top >= box.bottom && Math.abs(label.left - box.left) <= 1;
    }));
    assert(valid, 'Each batch must show its parameters once, below the images at the left');
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseUrl);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await openSettings();
  assert(await page.getByRole('button', { name: '1 张', exact: true }).getAttribute('aria-pressed') === 'true', 'Default count must be 1');
  for (const count of [1, 2, 3, 4]) {
    await selectCount(count);
    if (count === 4) {
      await assertFits();
      await screenshot('settings-desktop');
    }
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.locator('#studio-prompt').fill(`Batch browser check ${count}`);
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await page.waitForFunction(count => new URL(location.href).searchParams.get('job')?.endsWith(String(count).padStart(12, '0')), count);
    await page.locator('.studio-canvas .canvas-image-space img, .studio-canvas .canvas-batch-preview img').first().waitFor();
    await assertParameters();
    assert(requests[count - 1]?.count === count, `Count ${count} was not submitted`);
    assert(quotes.some(quote => quote.count === count), `Count ${count} was not quoted`);
    if (count < 4) await openSettings();
  }
  const lastId = [...jobs.keys()].at(-1);
  const canvas = page.getByRole('region', { name: '图片工作区', exact: true });
  await canvas.getByRole('button', { name: '预览结果 4', exact: true }).waitFor();
  assert(await canvas.locator('.canvas-batch-slot').count() === 4, 'Four outputs must be selectable');
  await canvas.getByRole('button', { name: '预览结果 3', exact: true }).click();
  await page.getByRole('button', { name: '关闭预览', exact: true }).waitFor();
  assert(await page.locator('.image-viewer-stage > img').getAttribute('src') === `/api/image/jobs/${lastId}/preview/2`, 'Preview must show output 3');
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await canvas.getByRole('status').filter({ hasText: '已生成 4 张' }).waitFor();
  await assertFits();
  await screenshot('results-desktop');
  await canvas.getByRole('button', { name: '继续编辑结果 3', exact: true }).click();
  await page.getByRole('button', { name: '管理参考图，共 1 张', exact: true }).waitFor();
  assert(references.at(-1)?.jobId === lastId && references.at(-1)?.index === 2, 'Continue used the wrong output index');
  await openSettings();
  assert(await page.getByRole('button', { name: '1 张', exact: true }).getAttribute('aria-pressed') === 'true', 'Continue editing should start with one image');
  await selectCount(3);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await openSettings();
  assert(await page.getByRole('button', { name: '3 张', exact: true }).getAttribute('aria-pressed') === 'true', 'Count was not restored on reload');

  await page.setViewportSize({ width: 390, height: 844 });
  await selectCount(4);
  await assertFits();
  await screenshot('settings-mobile');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  assert(await canvas.getByRole('button', { name: '预览结果 4', exact: true }).locator('img').getAttribute('src') === `/api/image/jobs/${lastId}/preview/3`, 'Mobile fourth result mapping failed');
  await assertFits();
  await screenshot('results-mobile');
  await assertParameters();

  const partialId = '00000000-0000-4000-8000-000000000099';
  const partial = makeJob(partialId, { ...requests.at(-1), parentJobId: undefined, count: 4 }, 3);
  partial.creditsRefunded = unitCredits;
  partial.error = { code: 'BATCH_PARTIAL_FAILURE', message: 'One output failed' };
  jobs.set(partialId, partial);
  await page.goto(`${baseUrl}/?job=${partialId}`);
  await page.getByRole('status').filter({ hasText: '已生成 3/4 张，1 张未完成，已退回 6 积分' }).waitFor();
  assert(await canvas.locator('.canvas-batch-slot[data-status="succeeded"]').count() === 3, 'Partial job must retain successful outputs');
  assert(await canvas.locator('.canvas-batch-slot[data-status="failed"]').count() === 1, 'Partial job must retain failed placeholder');
  await assertFits();
  await screenshot('partial-mobile');
  await assertParameters();
  assert(requests.length === 4, 'Unexpected extra generation request');
  return {
    passed: true, submittedCounts: requests.map(request => request.count),
    quotedCosts: [1, 2, 3, 4].map(count => count * unitCredits),
    restoredCount: 3, continuedOutputIndex: references.at(-1).index,
    partial: { completed: 3, requested: 4, creditsRefunded: unitCredits }, screenshots
  };
}
