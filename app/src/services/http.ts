/**
 * Common HTTP client for the free, keyless public servers this fork uses:
 * Photon (search) and the FOSSGIS Valhalla demo (routes). Both send
 * `Access-Control-Allow-Origin: *`, so there's no key, no account, no proxy.
 * They're fair-use servers: fine for one person, not for heavy traffic.
 */

const TIMEOUT_MS = 8_000;

/** Shown both for a real 429 from the server and for the local self-imposed cap
 * in `search-limit.ts`, so the experience is identical either way. */
export const QUOTA_MESSAGE = 'Demo search limit reached for now, try again later';

/** Error with a message the UI can show as-is. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Combines the caller's `signal` with a timeout of our own.
 *
 * Without the timeout, a request in an area with no coverage hangs forever
 * and the UI stays stuck on "searching..." indefinitely.
 */
function abortable(external: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new ApiError('Took too long')), ms);
  external?.addEventListener('abort', () => ctrl.abort(external.reason), { once: true });
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

export async function getJson<T>(
  base: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const { signal: merged, done } = abortable(signal, TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: merged });
    if (!res.ok) {
      // A 429 means the public server is rate-limiting us for a while:
      // expected on a free fair-use server, not a bug to chase.
      const hint = res.status === 429 ? QUOTA_MESSAGE : `Error ${res.status}`;
      throw new ApiError(hint, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // A deliberate cancellation is not a failure: it's propagated as-is so
    // the caller can tell it apart (autocomplete cancels constantly).
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('No connection');
  } finally {
    done();
  }
}
