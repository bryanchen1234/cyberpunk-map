import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, getJson } from './http';

function mockFetchOnce(status: number, body: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

describe('getJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed body on success', async () => {
    mockFetchOnce(200, { hello: 'world' });
    const data = await getJson<{ hello: string }>('https://x.test/', {});
    expect(data).toEqual({ hello: 'world' });
  });

  it('reports a rate-limit response as an expected, calm message, not a raw status code', async () => {
    // 429 is what a shared, keyless free-tier quota returns once it's spent
    // for the month: this is the demo's normal failure mode, not a bug, so
    // the message must say so instead of surfacing "Error 429".
    mockFetchOnce(429);
    await expect(getJson('https://x.test/', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      message: 'Demo search limit reached for now, try again later',
    });
  });

  it("shows the server's own error message when it sends one", async () => {
    mockFetchOnce(400, { error_code: 154, error: 'Path distance exceeds the max distance limit' });
    await expect(getJson('https://x.test/', {})).rejects.toMatchObject({
      status: 400,
      message: 'Path distance exceeds the max distance limit',
    });
  });

  it('falls back to a generic status message for anything else', async () => {
    mockFetchOnce(500);
    await expect(getJson('https://x.test/', {})).rejects.toMatchObject({ message: 'Error 500' });
  });

  it('lets an AbortError through as-is instead of wrapping it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')),
    );
    await expect(getJson('https://x.test/', {})).rejects.toBeInstanceOf(DOMException);
  });

  it('wraps other network failures as "no connection"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    await expect(getJson('https://x.test/', {})).rejects.toEqual(new ApiError('No connection'));
  });
});
