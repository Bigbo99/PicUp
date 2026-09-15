async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('http://localhost:3001/');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 100;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#338473'; ctx.fillRect(0, 0, 80, 100);
    ctx.fillStyle = '#f4cb80'; ctx.fillRect(20, 20, 40, 60);
    document.body.appendChild(canvas);
    return canvas.toDataURL();
  });
  const bytes = await page.locator('canvas').screenshot();
  await page.goto('http://localhost:3001/');
  const checks = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  let fail = true;
  let index = 0;
  await page.route('**/api/files', route => fail
    ? route.fulfill({ status: 400, json: { message: 'The uploaded file content is not a supported image &#x20;' } })
    : route.fulfill({ json: { id: `fixture-${++index}`, url: data, mimeType: 'image/png', size: bytes.length, createdAt: new Date().toISOString() } }));
  await page.locator('input[type=file]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: bytes });
  await page.getByText('无法识别这张图片，请将原图导出为 JPG、PNG 或 WebP 后重新上传。', { exact: true }).waitFor();
  check(true, 'unsupported image error is actionable Chinese without HTML entities');
  fail = false;
  await page.locator('input[type=file]').setInputFiles([{ name: 'test.png', mimeType: 'image/png', buffer: bytes }, { name: 'second.png', mimeType: 'image/png', buffer: bytes }]);
  await page.getByRole('button', { name: '管理参考图，共 2 张' }).waitFor();
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => {
      const button = document.querySelector('.composer-reference-stack .composer-add-image');
      const bounds = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    });
    check(true, `${width}px: stacked images do not cover the add button`);
    await page.screenshot({ path: `output/playwright/stack-final-${width}.png`, animations: 'disabled' });
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  return { checks };
}
