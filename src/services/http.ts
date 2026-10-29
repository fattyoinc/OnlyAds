/**
 * fetch wrapper with a hard timeout, bounded retries (exponential backoff +
 * jitter) and cancellation. Retries only on network errors, 408, 429 and 5xx —
 * never on other 4xx, which would just repeat a bad request.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 408 || e.status === 429 || e.status >= 500;
  if (e instanceof TimeoutError) return true;
  return !(e instanceof Error && e.name === 'AbortError'); // network failure → retry; caller abort → stop
}

async function attempt(url: string, timeoutMs: number, fetchImpl: typeof fetch, outer?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  outer?.addEventListener('abort', onOuterAbort);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const err = new HttpError(res.status, `HTTP ${res.status}`);
      (err as HttpError & { retryAfter?: string | null }).retryAfter = res.headers?.get?.('Retry-After');
      throw err;
    }
    return res;
  } catch (e) {
    if (timedOut) throw new TimeoutError(timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

export async function getJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, baseDelayMs = 400, signal, fetchImpl = fetch, sleep = defaultSleep, random = Math.random } = opts;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    try {
      const res = await attempt(url, timeoutMs, fetchImpl, signal);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i === retries || !isRetryable(e)) break;
      const retryAfter = Number((e as { retryAfter?: string }).retryAfter);
      const backoff = baseDelayMs * 2 ** i * (0.5 + random()); // jitter avoids thundering herds
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : backoff);
    }
  }
  throw lastErr;
}

/** Short, non-sensitive description for UI and logs (never includes URLs). */
export function describeError(e: unknown): string {
  if (e instanceof TimeoutError) return 'The server took too long to respond.';
  if (e instanceof HttpError) return e.status === 429 ? 'Too many requests — try again shortly.' : `Server error (${e.status}).`;
  return 'Couldn’t reach Only Ads. Check your connection.';
}
