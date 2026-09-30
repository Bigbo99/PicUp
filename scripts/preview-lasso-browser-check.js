async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const base = 'http://127.0.0.1:3001';
  const model = { provider: 'lasso-check', providerType: 'openai-images', model: 'gpt-image-2', enabled: true, supportsMask: true,
    supportedRatios: ['auto', '1:1'], supportedQualities: ['1K'], maxInputImages: 4, costCredits: 5 };
  const job = { id: '00000000-0000-4000-8000-00000000a550', userId: 'lasso-user', provider: model.provider, selectedProvider: model.provider,
    model: model.model, selectedModel: model.model, status: 'succeeded', mode: 'generate', prompt: '自行车订单截图', finalPrompt: 'mock',
    quality: '1K', aspectRatio: 'auto', count: 1, inputFiles: [], imageIds: [], textOutputs: [], error: null, creditsReserved: 5,
    outputImages: [{ url: `${base}/api/image/jobs/00000000-0000-4000-8000-00000000a550/preview/0`, mimeType: 'image/png', width: 1263, height: 1070 }],
    createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z' };
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (/\/preview\/\d+$/.test(path)) return route.fulfill({ path: 'apps/web/public/brand/picup-icon.png', contentType: 'image/png' });
    if (path === '/api/auth/me') return json({ user: { id: 'lasso-user', role: 'user', isGuest: false }, credits: { balance: 200, rechargePlans: [] }, quota: { remaining: 0 } });
    if (path === '/api/models') return json({ source: 'runtime', models: [model], defaultProvider: model.provider, defaultModel: model.model });
    if (path === '/api/studio/preferences') return json({ theme: 'dark', provider: model.provider, model: model.model, quality: '1K', aspectRatio: 'auto' });
    if (path === `/api/image/jobs/${job.id}`) return json(job);
    if (path.endsWith('/quote')) return json({ available: true, credits: 5, paymentMode: 'credits' });
    if (route.request().method() === 'POST') throw Error(`Lasso check must not submit: ${path}`);
    return json({ items: [] });
  });
  const assert = (value, message) => { if (!value) throw Error(message); };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/?job=${job.id}`);
  await page.locator('.canvas-image-meta').first().waitFor();
  // Result size belongs with the generation parameters, not beside the "继续编辑" button.
  assert((await page.locator('.canvas-image-meta').first().textContent()).includes('1263 × 1070'), 'Result size missing from parameter line');
  assert(!(await page.locator('.canvas-result-footer').textContent()).includes('×'), 'Result size still shown in footer');
  await page.locator('.canvas-result-footer').screenshot({ path: 'output/preview-result-footer.png' });
  await page.locator('.canvas-result-details').first().screenshot({ path: 'output/preview-result-details.png' });

  await page.locator('.canvas-image-space').click();
  await page.getByRole('button', { name: '消除', exact: true }).click();
  const layer = page.locator('.preview-markup-layer');
  await layer.waitFor();
  const box = await layer.boundingBox();
  const draw = async points => {
    await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 2 });
    await page.mouse.up();
  };
  // An open stroke stays a brush line.
  await draw(Array.from({ length: 12 }, (_, i) => [.1 + i * .03, .85]));
  assert(await page.locator('[data-layer="mask"] [data-lasso]').count() === 0, 'Open stroke must not be filled');
  // A loop that stops just short of its start is closed and filled.
  await draw(Array.from({ length: 34 }, (_, i) => {
    const angle = i / 36 * Math.PI * 2;
    return [.5 + Math.cos(angle) * .25, .45 + Math.sin(angle) * .25];
  }));
  assert(await page.locator('[data-layer="mask"] [data-lasso="true"]').count() === 1, 'Closed loop should fill its interior');
  await page.waitForTimeout(150);
  await page.locator('.image-viewer').screenshot({ path: 'output/preview-lasso.png' });
  return 'preview lasso check passed';
}
