async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const userId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const jobId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const now = new Date().toISOString();
  const requests = [];
  const job = { id: jobId, userId, status: 'refunded', mode: 'generate', provider: 'grsai', model: 'nano-banana-2',
    template: 'auto', prompt: 'first attempt', imageIds: [], inputFiles: [], outputImages: [], textOutputs: [],
    aspectRatio: 'auto', quality: '1K', creditsReserved: 2, paymentMode: 'credits', createdAt: now, updatedAt: now,
    error: { code: 'TIMEOUT', message: 'Test provider timeout' } };
  await page.route('**/api/**', async route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (path === '/api/auth/me') return json({ user: { id: userId, role: 'user', isGuest: false, status: 'active', creditBalance: 20 }, quota: { remaining: 1 }, credits: { balance: 20, rechargePlans: [] } });
    if (path === '/api/models') return json({ source: 'runtime', routing: { default: { provider: 'grsai', model: 'nano-banana-2' } }, models: [{ provider: 'grsai', model: 'nano-banana-2', displayName: 'Nano Banana 2', enabled: true, costCredits: 2, maxInputImages: 6, supportedRatios: ['auto'], supportedQualities: ['1K'] }] });
    if (path === '/api/image/jobs/quote') return json({ paymentMode: 'credits', credits: 2, available: true });
    if (path === '/api/image/jobs' && route.request().method() === 'POST') {
      requests.push(route.request().postDataJSON());
      return json({ jobId, status: 'queued', creditsReserved: 2, paymentMode: 'credits' });
    }
    if (path === `/api/image/jobs/${jobId}`) return json(job);
    if (path === '/api/studio/preferences') return json({});
    return json({ items: [], next: null });
  });
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.locator('#studio-prompt[contenteditable="true"]').fill('first attempt');
  await page.getByRole('button', { name: '生成', exact: true }).click();
  await page.waitForFunction(id => {
    const saved = JSON.parse(sessionStorage.getItem(`picup:studio:${id}`) || '{}');
    return !saved.awaitingJobId && !saved.parentJobId;
  }, userId);
  await page.locator('#studio-prompt[contenteditable="true"]').fill('second attempt');
  await page.getByRole('button', { name: '生成', exact: true }).click();
  if (requests.length !== 2 || requests[1].parentJobId) throw new Error('Failed job remained the parent of the next submission');
  await page.reload();
  await page.locator('#studio-prompt[contenteditable="true"]').fill('after reload');
  await page.getByRole('button', { name: '生成', exact: true }).click();
  if (requests.length !== 3 || requests[2].parentJobId) throw new Error('Reload restored the failed parent');
  return { passed: true, submissions: requests.length, failedParentRemoved: true };
}
