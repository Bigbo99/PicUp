type ThumbnailSource = { url: string; thumbnailUrl?: string; id?: string };

export function thumbnailUrl(image: ThumbnailSource): string {
  if (image.thumbnailUrl) return image.thumbnailUrl;
  // Restored drafts may predate thumbnailUrl. Rebuild their authenticated URL.
  const url = image.id ? `/api/files/${encodeURIComponent(image.id)}/content` : image.url;
  if (!url.startsWith('/api/files/') && !url.startsWith('/api/image/jobs/')) return url;
  const parsed = new URL(url, 'http://localhost');
  parsed.searchParams.set('variant', 'thumbnail');
  return `${parsed.pathname}${parsed.search}`;
}
