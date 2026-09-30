async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const base = 'http://127.0.0.1:3001';
  const parentId = '00000000-0000-4000-8000-000000000101';
  const jobId = '00000000-0000-4000-8000-000000000102';
  const fileId = '00000000-0000-4000-8000-000000000103';
  const model = { provider: 'check', providerType: 'openai-images', model: 'gpt-image-2', enabled: true,
    supportedRatios: ['auto', '1:1'], supportedQualities: ['1K'], maxInputImages: 4, costCredits: 5 };
  const file = { id: fileId, url: '/media/inputs/legacy.png', hash: 'reference-hash', mimeType: 'image/png', size: 1000, createdAt: '2026-09-29T00:00:00Z' };
  const parent = { id: parentId, status: 'succeeded', mode: 'generate', prompt: 'Thumbnail check', finalPrompt: '', provider: model.provider, model: model.model,
    quality: '1K', aspectRatio: 'auto', count: 1, inputFiles: [], imageIds: [], textOutputs: [], creditsReserved: 5,
    outputImages: [{ url: '/media/outputs/legacy.png', mimeType: 'image/png', width: 1200, height: 800 }],
    createdAt: '2026-09-29T00:00:00Z', updatedAt: '2026-09-29T00:00:00Z' };
  const job = { ...parent, id: jobId, parentJobId: parentId, inputFiles: [file], imageIds: [fileId],
    promptParts: [{ type: 'text', text: 'Edit ' }, { type: 'image', fileId, label: 'Reference' }] };
  const requests = [];
  page.on('request', request => { if (/\/preview\/\d+|\/content|\/media\/|output-hashes/.test(request.url())) requests.push(request.url()); });
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (/\/preview\/\d+$|\/content$/.test(path)) return route.fulfill({ path: 'apps/web/public/brand/picup-icon.png', contentType: 'image/png' });
    if (path.endsWith('/output-hashes')) return json(['reference-hash']);
    if (path === '/api/auth/me') return json({ user: { id: 'thumbnail-check', role: 'user', isGuest: false }, credits: { balance: 200, rechargePlans: [] }, quota: { remaining: 0 } });
    if (path === '/api/models') return json({ source: 'runtime', models: [model], defaultProvider: model.provider, defaultModel: model.model });
    if (path === '/api/studio/preferences') return json({ theme: 'light', provider: model.provider, model: model.model, quality: '1K', aspectRatio: 'auto' });
    if (path === `/api/image/jobs/${jobId}`) return json(job);
    if (path === `/api/image/jobs/${parentId}`) return json(parent);
    if (path.endsWith('/quote')) return json({ available: true, credits: 5, paymentMode: 'credits' });
    if (route.request().method() === 'POST') throw Error(`Unexpected mutation: ${path}`);
    return json({ items: [] });
  });
  const assert = (value, message) => { if (!value) throw Error(message); };
  for (const width of [1440, 390]) {
    requests.length = 0;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/?job=${jobId}`);
    await page.locator('.canvas-image-space img').waitFor();
    await page.locator('.chat-attachment.is-reference').waitFor();
    const sources = await page.locator('.canvas-image-space img, .chat-input-images img, .prompt-image-mention img, .chat-prior-image img').evaluateAll(images => images.map(image => image.src));
    assert(sources.length >= 4, 'Missing image surfaces');
    assert(sources.every(url => url.includes('variant=thumbnail')), 'A small image uses the original URL');
    assert(requests.some(url => url.endsWith('/output-hashes')), 'Fingerprint metadata was not requested');
    assert(requests.filter(url => !url.endsWith('/output-hashes')).every(url => url.includes('variant=thumbnail')), 'Original image downloaded before opening preview');
    await page.locator('.canvas-image-space').click();
    await page.locator('.image-viewer img').first().waitFor();
    const thumbs = await page.locator('.preview-editor-thumbs img').evaluateAll(images => images.map(image => image.src));
    assert(thumbs.length >= 3 && thumbs.every(url => url.includes('variant=thumbnail')), 'Preview strip downloads original images');
    const originals = requests.filter(url => !url.endsWith('/output-hashes') && !url.includes('variant=thumbnail'));
    assert(originals.length === 1 && originals[0].endsWith(`/jobs/${jobId}/preview/0`), 'Preview must load only the selected original');
    await page.screenshot({ path: `output/playwright/thumbnail-check-${width}.png` });
  }
  return 'Desktop/mobile: small images use thumbnails; reference detection fetches metadata only; preview loads one selected original. Image responses are mocked here; actual conversion is covered by thumbnails.test.ts.';
}
