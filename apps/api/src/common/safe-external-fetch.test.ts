import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafeExternalUrl, readLimitedResponse } from './safe-external-fetch';

describe('safe external fetch', () => {
  it('rejects non-HTTPS URLs', async () => {
    await assert.rejects(() => assertSafeExternalUrl('http://example.com/image.png'), /must use HTTPS/);
  });

  it('rejects credentials and non-standard HTTPS ports', async () => {
    await assert.rejects(() => assertSafeExternalUrl('https://user:pass@example.com/image.png'), /credentials/);
    await assert.rejects(() => assertSafeExternalUrl('https://example.com:8443/image.png'), /standard HTTPS port/);
  });

  it('rejects local and private literal addresses without DNS', async () => {
    await assert.rejects(() => assertSafeExternalUrl('https://localhost/image.png'), /hostname is not allowed/);
    await assert.rejects(() => assertSafeExternalUrl('https://127.0.0.1/image.png'), /private or reserved address/);
    await assert.rejects(() => assertSafeExternalUrl('https://[::1]/image.png'), /private or reserved address/);
    await assert.rejects(() => assertSafeExternalUrl('https://192.0.2.1/image.png'), /private or reserved address/);
    await assert.rejects(() => assertSafeExternalUrl('https://198.51.100.1/image.png'), /private or reserved address/);
    await assert.rejects(() => assertSafeExternalUrl('https://203.0.113.1/image.png'), /private or reserved address/);
    await assert.rejects(() => assertSafeExternalUrl('https://[64:ff9b::1]/image.png'), /private or reserved address/);
  });

  it('reads a response within the configured limit', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]));
    assert.deepEqual(await readLimitedResponse(response, 3), Buffer.from([1, 2, 3]));
  });

  it('rejects declared and streamed bodies over the configured limit', async () => {
    const declared = new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-length': '3' }
    });
    await assert.rejects(() => readLimitedResponse(declared, 2), /exceeds 2 bytes/);

    const streamed = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      }
    }));
    await assert.rejects(() => readLimitedResponse(streamed, 2), /exceeds 2 bytes/);
  });
});
