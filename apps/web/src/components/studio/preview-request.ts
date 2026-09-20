// Compare the actual bytes so upload reuse also works on HTTP LAN addresses.
export async function samePreviewFiles(left: (File | undefined)[], right: (File | undefined)[]) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const a = left[i]; const b = right[i];
    if (a === b) continue;
    if (!a || !b || a.size !== b.size || a.type !== b.type) return false;
    const [aBytes, bBytes] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    const other = new Uint8Array(bBytes);
    if (!new Uint8Array(aBytes).every((value, index) => value === other[index])) return false;
  }
  return true;
}

export function previewRequestId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
