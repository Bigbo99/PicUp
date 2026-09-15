async (page) => {
  const editor = page.getByRole('textbox', { name: '创作描述' });
  const checks = [];
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  await editor.fill('前文后文');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.type('@');
  await page.getByRole('textbox', { name: '搜索图片或主体' }).fill('品牌');
  await page.getByRole('option', { name: '品牌人物 主体' }).waitFor();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  check(await editor.textContent() === '前文品牌人物主体 后文', 'search and keyboard selection preserve insertion between existing text');
  await editor.fill('前文后文');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.type('@');
  await page.getByRole('option', { name: '创建主体', exact: true }).click();
  await page.getByRole('textbox', { name: '主体名称', exact: true }).fill('原位主体');
  await page.getByRole('button', { name: '保存主体', exact: true }).click();
  await page.getByRole('dialog', { name: '创建主体' }).waitFor({ state: 'hidden' });
  check(await editor.textContent() === '前文原位主体主体 后文', 'creating from inline @ replaces trigger and preserves following text');
  await editor.click(); await page.keyboard.press('Control+a');
  const clipboard = await editor.evaluate(el => { const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })); return { html: data.getData('text/html'), text: data.getData('text/plain') }; });
  await page.keyboard.press('Control+End');
  await editor.evaluate((el, clipboard) => { const data = new DataTransfer(); data.setData('text/html', clipboard.html); data.setData('text/plain', clipboard.text); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, clipboard);
  check(await editor.locator('[data-image-mention]').count() === 2, 'copy and paste retain structured image nodes');
  await page.keyboard.press('Control+z');
  check(await editor.locator('[data-image-mention]').count() === 1, 'pasted image nodes can be undone');
  return { checks };
}
