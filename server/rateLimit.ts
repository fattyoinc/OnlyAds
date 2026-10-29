/**
 * In-memory token-bucket rate limiter keyed by client IP. Good for a single
 * instance; with several instances, move buckets to Redis or rely on the
 * edge/CDN rate limiter. Memory is bounded: the least-recently-seen keys are
 * evicted beyond maxKeys. IPs are never logged or persisted.
 */
export interface RateLimitOptions {
  capacity: number; // burst size
  refillPerSec: number; // sustained rate
  maxKeys?: number;
}

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private opts: RateLimitOptions) {}

  /** Returns 0 if allowed, otherwise seconds until a token is available. */
  take(key: string, now = Date.now()): number {
    const { capacity, refillPerSec, maxKeys = 50_000 } = this.opts;
    let b = this.buckets.get(key);
    if (b) this.buckets.delete(key); // re-insert to keep Map order = recency
    else b = { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
    b.at = now;
    let wait = 0;
    if (b.tokens >= 1) b.tokens -= 1;
    else wait = Math.ceil((1 - b.tokens) / refillPerSec);
    this.buckets.set(key, b);
    if (this.buckets.size > maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    return wait;
  }

  get size() {
    return this.buckets.size;
  }
}
