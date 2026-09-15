async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('http://localhost:3000/');
  const checks = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  let quotes = 0;
  page.on('request', request => { if (request.url().includes('/quote')) quotes++; });
  await page.getByRole('button', { name: '积分充值', exact: true }).waitFor();
  await page.waitForTimeout(1000);
  const before = quotes;
  await page.getByRole('textbox', { name: '你想创作什么？' }).fill('一张证件照，修改文字，海报设计');
  await page.waitForTimeout(1200);
  check(quotes === before, 'typing does not request a new quote');
  check(/\d+ 积分/.test(await page.locator('.composer-submit').innerText()), 'credits beside send');
  check(!/¥|免费|计算/.test(await page.locator('.composer-submit').innerText()), 'no price or recalculation in composer');
  await page.getByRole('button', { name: '积分充值', exact: true }).click();
  await page.getByRole('dialog', { name: '积分充值' }).waitFor();
  check(await page.locator('.recharge-options button').count() > 0, 'header opens recharge plans');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '账户与设置', exact: true }).click();
  const original = await (await page.request.get('http://localhost:3000/api/studio/preferences')).json();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.studioTheme === 'dark');
  await page.getByLabel('默认清晰度').selectOption('2K');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => document.documentElement.dataset.studioTheme === 'dark'), 'dropdown preserves dark theme');
  check(!await page.getByText('发送方式', { exact: true }).count() && !await page.getByText('生成后自动继续编辑', { exact: true }).count(), 'removed obsolete preferences');
  check(await page.locator('.account-identity .account-credit').count() === 1, 'balance grouped with identity');
  check(await page.getByLabel('默认模型').count() === 1, 'default model setting exists');
  await page.reload();
  await page.getByLabel('默认清晰度').waitFor();
  check(await page.evaluate(() => document.documentElement.dataset.studioTheme === 'dark'), 'theme persists after reload');
  await page.request.patch('http://localhost:3000/api/studio/preferences', { data: { theme: original.theme ?? 'system', quality: original.quality ?? '1K', aspectRatio: original.aspectRatio ?? 'auto', provider: original.provider ?? 'auto', model: original.model ?? 'auto' } });
  await page.goto('http://localhost:3000/');
  await page.getByRole('textbox', { name: '你想创作什么？' }).fill('');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `output/playwright/credits-${viewport.width}.png` });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${viewport.width}`);
    check(await page.locator('.studio-wordmark').evaluate(img => img.complete && img.naturalWidth > 0), `brand loaded at ${viewport.width}`);
    const label = await page.locator('.composer-submit .quote-label').boundingBox();
    const send = await page.locator('.chat-send').boundingBox();
    check(Math.abs(label.y + label.height / 2 - send.y - send.height / 2) < 5, `credits aligned with send at ${viewport.width}`);
    const nav = await page.locator('.studio-navigation button').evaluateAll(buttons => buttons.map(button => ({ text: button.textContent, x: button.getBoundingClientRect().x })));
    if (viewport.width < 1024) check(nav[0].x < nav[1].x && nav[1].x < nav[2].x, 'creation, gallery, account order');
  }
  return checks;
}
