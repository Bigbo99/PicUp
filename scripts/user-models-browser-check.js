async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const requests = [];
  const choicesByModel = [
    ['nano-banana-2', 'Nano Banana 2'], ['nano-banana-pro', 'Nano Banana Pro'],
    ['gpt-image-2', 'GPT Image 2'], ['gpt-image-2.5-flare', 'GPT Image 2.5 Flare'],
    ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'], ['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image'],
    ['custom-image-model', 'Custom Image']
  ];
  const models = choicesByModel.map(([model, displayName], index) => ({ provider: 'internal-provider', model, displayName,
    description: 'Internal provider configuration timeoutMs upstreamModel', enabled: true,
    supportedRatios: ['auto', '1:1'], supportedQualities: ['1K', '2K', '4K'], maxInputImages: 6, costCredits: index + 1 }));
  models.push({ ...models[3], provider: 'preferred-provider' });
  models.push({ ...models[0], model: 'gpt-image-1', displayName: 'GPT Image 1' });
  models.push({ ...models[0], model: 'disabled-model', displayName: 'Disabled Model', enabled: false });
  const routing = { default: { provider: 'preferred-provider', model: 'gpt-image-2.5-flare' }, professional: { provider: 'internal-provider', model: 'gpt-image-2.5-sunburst' } };
  let preferences = { provider: 'internal-provider', model: 'nano-banana-pro', quality: '1K', aspectRatio: 'auto' };
  const expectedChoices = ['自动推荐', ...choicesByModel.map(([, name]) => name)];
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (path === '/api/auth/me') return json({ user: { id: 'model-choice-user', role: 'user', isGuest: false }, credits: { balance: 200, rechargePlans: [] }, quota: { remaining: 1 } });
    if (path === '/api/models') return json({ source: 'runtime', models, routing });
    if (path === '/api/studio/preferences') {
      if (route.request().method() === 'PATCH') preferences = { ...preferences, ...route.request().postDataJSON() };
      return json(preferences);
    }
    if (path.endsWith('/quote')) {
      const input = route.request().postDataJSON();
      const selected = models.find(model => model.model === input.model && model.provider === input.provider);
      if (!selected) throw Error('Quote uses an unavailable model');
      return json({ available: true, credits: selected.costCredits * (input.count ?? 1), paymentMode: 'credits' });
    }
    if (path === '/api/image/jobs' && route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ status: 400, json: { message: 'Test submission recorded' } });
    }
    return json({ items: [] });
  });
  await page.goto('http://127.0.0.1:3001/');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.model-selector')?.textContent.includes('Nano Banana Pro'));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:3001/');
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
    const choices = page.locator('.composer-model-option');
    await choices.first().waitFor();
    if (JSON.stringify(await choices.locator('strong').allTextContents()) !== JSON.stringify(expectedChoices)) throw Error('Models missing or duplicated');
    if (await choices.locator('small').count() !== expectedChoices.length) throw Error('User model guidance missing');
    if (/internal-provider|Internal provider|timeoutMs|upstreamModel/.test((await choices.allTextContents()).join(' '))) throw Error('Backend model descriptions remain visible');
    await page.screenshot({ path: `output/playwright/user-models-${width}.png` });
    await choices.filter({ hasText: 'Nano Banana 2' }).click();
    await page.getByRole('button', { name: '比例与清晰度', exact: true }).click();
    await page.getByRole('button', { name: '3 张', exact: true }).click();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    for (const [model, name] of choicesByModel) {
      await page.getByRole('button', { name: '选择模型', exact: true }).click();
      await page.getByRole('button', { name, exact: true }).click();
      await page.locator('#studio-prompt').fill(`Test ${name}`);
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/api/image/jobs') && response.request().method() === 'POST'),
        page.getByRole('button', { name: '生成', exact: true }).click()
      ]);
      const input = requests.at(-1);
      const provider = model === 'gpt-image-2.5-flare' ? 'preferred-provider' : 'internal-provider';
      if (input.model !== model || input.provider !== provider || input.count !== 3) throw Error(`Incorrect batch request for ${name}`);
      const cost = models.find(item => item.model === model).costCredits * 3;
      if (await page.locator('.send-cost').textContent() !== `${cost} 积分`) throw Error(`Incorrect price for ${name}`);
    }
    await page.getByRole('button', { name: '选择模型', exact: true }).click();
    await page.getByRole('button', { name: '自动推荐', exact: true }).click();
    await page.getByRole('button', { name: '比例与清晰度', exact: true }).click();
    await page.getByRole('button', { name: '4K', exact: true }).click();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.model-selector')?.title === 'GPT Image 2.5 Sunburst');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw Error('Horizontal layout overflow');
  }
  await page.goto('http://127.0.0.1:3001/?view=account');
  const defaults = page.getByRole('combobox', { name: '默认模型', exact: true });
  await defaults.waitFor();
  if (JSON.stringify(await defaults.locator('option').allTextContents()) !== JSON.stringify(expectedChoices)) throw Error('Preference models differ');
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/studio/preferences') && response.request().method() === 'PATCH'),
    defaults.selectOption({ label: 'Nano Banana 2' })
  ]);
  if (preferences.model !== 'nano-banana-2') throw Error('Default preference not saved');
  return { passed: true, options: expectedChoices, batchSubmissions: requests.length, defaultModel: preferences.model };
}
