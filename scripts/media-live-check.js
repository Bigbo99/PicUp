async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('http://localhost:3000/');
  const assets = await (await page.request.get('/api/studio/assets')).json();
  const results = [];
  for (const asset of assets.items.slice(0, 6)) {
    const url = asset.fileId ? `/api/files/${asset.fileId}/content` : `/api/image/jobs/${asset.jobId}/preview/${asset.index}`;
    const response = await page.request.get(url);
    results.push({ kind: asset.kind, status: response.status(), type: response.headers()['content-type'], bytes: (await response.body()).length });
  }
  return { assets: assets.items.length, results };
}
