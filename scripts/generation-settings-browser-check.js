async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const ratios = ['auto', '1:1', '3:4', '16:9', '4:3', '9:16', '2:3', '3:2', '21:9', '4:5', '5:4'];
  let theme = 'dark';
  let providerType = 'openai-images';
  const model = () => ({ provider: 'settings-check', providerType, model: providerType === 'grsai' ? 'nano-banana-2' : 'gpt-image-2.5-sunburst',
    enabled: true, displayName: 'Image model', supportedRatios: providerType === 'grsai' ? [...ratios, '1:4', '4:1', '1:8', '8:1'] : ratios,
    supportedQualities: ['1K', '2K', '4K'], maxInputImages: 6, costCredits: 5 });
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (path === '/api/auth/me') return json({ user: { id: 'settings-check-user', role: 'user', isGuest: false }, credits: { balance: 200, rechargePlans: [] }, quota: { remaining: 0 } });
    if (path === '/api/models') return json({ source: 'runtime', models: [model()], defaultProvider: model().provider, defaultModel: model().model });
    if (path === '/api/studio/preferences') return json({ theme, provider: model().provider, model: model().model, quality: '2K', aspectRatio: '1:1' });
    if (path.endsWith('/quote')) return json({ available: true, credits: 5 * (route.request().postDataJSON().count ?? 1), paymentMode: 'credits' });
    if (path === '/api/image/jobs' && route.request().method() === 'POST') throw Error('Visual check must not generate images');
    return json({ items: [] });
  });
  const assert = (value, message) => { if (!value) throw Error(message); };
  const open = async () => {
    await page.goto('http://127.0.0.1:3001/');
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: '比例与清晰度', exact: true }).click();
    await page.getByRole('dialog', { name: '生成设置', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.generation-segments button[aria-pressed="true"]')?.textContent?.includes('1:1')
      && [...document.querySelectorAll('.generation-segments button')].some(el => el.textContent === '2K' && el.getAttribute('aria-pressed') === 'true'));
  };
  const dimensionsAre = async (width, height) => page.waitForFunction(([w, h]) =>
    document.querySelector('[aria-label="输出宽度"]')?.value === w
    && document.querySelector('[aria-label="输出高度"]')?.value === h, [width, height]);
  const fits = async () => {
    const layout = await page.locator('.generation-settings').evaluate(dialog => {
      const bounds = dialog.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: innerWidth, height: innerHeight,
        overflow: dialog.scrollWidth > dialog.clientWidth + 1,
        textOverflow: [...dialog.querySelectorAll('button, input')].some(el => el.scrollWidth > el.clientWidth + 1) };
    });
    assert(layout.left >= 0 && layout.right <= layout.width && layout.top >= 0 && layout.bottom <= layout.height + 1, `Dialog exceeds viewport: ${JSON.stringify(layout)}`);
    assert(!layout.overflow && !layout.textOverflow, 'Control text overflows');
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open();
    await page.getByRole('button', { name: '4 张', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.quote-label')?.textContent === '20 积分');
    assert(await page.getByLabel('输出宽度').inputValue() === '2048', 'Square width does not match request');
    assert(await page.getByLabel('输出高度').inputValue() === '2048', 'Square height does not match request');
    await fits();
    await page.screenshot({ path: `output/playwright/generation-settings-dark-${width}.png` });
    await page.getByRole('button', { name: '16:9', exact: true }).click();
    await dimensionsAre('2048', '1152');
    assert(await page.getByLabel('输出宽度').inputValue() === '2048', 'Landscape width incorrect');
    assert(await page.getByLabel('输出高度').inputValue() === '1152', 'Landscape height incorrect');
    await page.getByRole('button', { name: '智能', exact: true }).click();
    await dimensionsAre('', '');
    assert(await page.getByLabel('输出宽度').inputValue() === '', 'Auto ratio must not promise fixed dimensions');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: '比例与清晰度', exact: true }).click();
    assert(await page.getByRole('button', { name: '4 张', exact: true }).getAttribute('aria-pressed') === 'true', 'Count lost on reopen');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: '生成设置', exact: true }).waitFor({ state: 'detached' });
    assert(await page.getByRole('dialog', { name: '生成设置', exact: true }).count() === 0, 'Escape did not close settings');
  }
  theme = 'light';
  await open();
  await fits();
  await page.screenshot({ path: 'output/playwright/generation-settings-light-mobile.png' });
  providerType = 'grsai';
  await open();
  assert(await page.locator('.generation-ratios button').count() === 15, 'Supported ratios lost');
  assert(await page.getByLabel('输出宽度').inputValue() === '', 'Unknown provider dimensions should not use GPT mapping');
  await page.setViewportSize({ width: 320, height: 640 });
  await fits();
  await page.screenshot({ path: 'output/playwright/generation-settings-compact.png' });
  return { passed: true, themes: ['dark', 'light'], widths: [1440, 390, 320], square: '2048x2048', landscape: '2048x1152', ratios: 15 };
}
