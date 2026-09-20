// Export the visible annotations as a guide, leaving the original image intact.
export async function exportPreviewGuide(picture: HTMLImageElement, overlay: SVGSVGElement): Promise<File | undefined> {
  if (!overlay.querySelector('[data-layer="annotation"] > *, [data-layer="comments"] > *')) return undefined;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 2048 / Math.max(picture.naturalWidth, picture.naturalHeight));
  canvas.width = Math.round(picture.naturalWidth * scale);
  canvas.height = Math.round(picture.naturalHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法导出标记，请重试');
  const svg = overlay.cloneNode(true) as SVGSVGElement;
  svg.querySelectorAll('[data-editor-ui]').forEach(node => node.remove());
  svg.querySelector('[data-layer="mask"]')?.remove();
  svg.removeAttribute('style');
  svg.setAttribute('width', String(canvas.width));
  svg.setAttribute('height', String(canvas.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) return undefined;
    context.globalCompositeOperation = 'destination-over';
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('标记导出失败')), 'image/png'));
    return new File([blob], 'picup-edit-guide.png', { type: 'image/png' });
  } finally { URL.revokeObjectURL(url); }
}

export async function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片导出失败')), 'image/png'));
  if (blob.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB，请减小尺寸');
  return new File([blob], name, { type: 'image/png' });
}

export async function exportPreviewMask(picture: HTMLImageElement, overlay: SVGSVGElement): Promise<{ mask: File; original: File } | undefined> {
  if (!overlay.querySelector('[data-layer="mask"] > *')) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = picture.naturalWidth; canvas.height = picture.naturalHeight;
  if (canvas.width * canvas.height > 32_000_000) throw new Error('原图过大，请先调整尺寸');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法导出选区');
  const svg = overlay.cloneNode(true) as SVGSVGElement;
  svg.querySelectorAll('[data-editor-ui]').forEach(node => node.remove());
  svg.removeAttribute('style'); svg.setAttribute('width', String(canvas.width)); svg.setAttribute('height', String(canvas.height));
  svg.querySelectorAll('[data-layer]:not([data-layer="mask"])').forEach(node => node.remove());
  svg.querySelector('[data-layer="mask"]')?.setAttribute('opacity', '1');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let selected = false;
    for (let i = 0; i < pixels.data.length; i += 4) {
      const active = pixels.data[i + 3] > 127;
      selected ||= active;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      pixels.data[i + 3] = active ? 0 : 255;
    }
    if (!selected) return undefined;
    context.putImageData(pixels, 0, 0);
    const mask = await canvasFile(canvas, 'picup-mask.png');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0);
    return { mask, original: await canvasFile(canvas, 'picup-source.png') };
  } finally { URL.revokeObjectURL(url); }
}
