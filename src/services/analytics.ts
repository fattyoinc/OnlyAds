/**
 * Product analytics — provider-agnostic, privacy-first.
 *
 * - Only events/properties in analyticsSchema.ts can be recorded (no IDs, free
 *   text, search queries or coordinates). Exact counts are bucketed.
 * - Until the user's choice is known (first launch, before onboarding ends)
 *   events wait in a small in-memory buffer. If the user opts out, the buffer
 *   is discarded and nothing is ever sent.
 * - Delivery goes through a pluggable Transport. The default sends batches to
 *   our own aggregate endpoint (server: POST /v1/events, /v1/impressions),
 *   which stores daily counts only. Swapping providers = writing a Transport.
 * - Ad impressions are counted once per offer per app session.
 */
import { bucket, sanitizeEvent, type AnalyticsEvent, type AnalyticsProps } from './analyticsSchema';

export { bucket };
export type { AnalyticsEvent };

export interface Transport {
  sendEvents(events: { name: AnalyticsEvent; props: AnalyticsProps }[]): Promise<void>;
  sendImpressions(offerIds: string[]): Promise<void>;
}

type Mode = 'pending' | 'enabled' | 'disabled';

const MAX_BUFFER = 100;
const BATCH = 20;
let mode: Mode = 'pending';
let transport: Transport | null = null;
let events: { name: AnalyticsEvent; props: AnalyticsProps }[] = [];
let impressions: string[] = [];
const seenThisSession = new Set<string>();
let flushing = false;
let debugSink: ((event: AnalyticsEvent, props: AnalyticsProps) => void) | null = null;

/** Called by the app once the user's choice is known (and whenever it changes). */
export function configureAnalytics(opts: { enabled: boolean; transport?: Transport | null }): void {
  mode = opts.enabled ? 'enabled' : 'disabled';
  transport = opts.transport ?? null;
  if (mode === 'disabled') {
    events = [];
    impressions = [];
  } else if (events.length >= BATCH || impressions.length >= BATCH) void flushAnalytics();
}

/** Test/dev hook to observe sanitized events. */
export function setAnalyticsSink(fn: typeof debugSink): void {
  debugSink = fn;
}

export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  if (mode === 'disabled') return;
  const clean = sanitizeEvent(event, props);
  if (!clean) return;
  if (typeof __DEV__ !== 'undefined' && __DEV__ && process.env.NODE_ENV !== 'test') console.log('[analytics]', clean.name, clean.props);
  try {
    debugSink?.(clean.name, clean.props);
  } catch {
    // never let analytics break the app
  }
  events.push(clean);
  if (events.length > MAX_BUFFER) events.shift();
  if (mode === 'enabled' && events.length >= BATCH) void flushAnalytics();
}

/**
 * An ad was on screen. Counted once per offer per session. Bundled sample offers
 * (`localOnly`) don't exist on the server, so they're never sent.
 */
export function trackImpression(offerId: string, localOnly: boolean): void {
  if (mode === 'disabled' || localOnly || seenThisSession.has(offerId)) return;
  seenThisSession.add(offerId);
  impressions.push(offerId);
  if (impressions.length > MAX_BUFFER) impressions.shift();
  if (mode === 'enabled' && impressions.length >= BATCH) void flushAnalytics();
}

/** Send what's buffered. Safe to call often (app background, timers). Failures drop the batch — no retry storms. */
export async function flushAnalytics(): Promise<void> {
  if (mode !== 'enabled' || !transport || flushing) return;
  flushing = true;
  try {
    while (events.length) {
      const batch = events.splice(0, BATCH);
      await transport.sendEvents(batch).catch(() => {});
    }
    while (impressions.length) {
      const batch = impressions.splice(0, BATCH * 5);
      await transport.sendImpressions(batch).catch(() => {});
    }
  } finally {
    flushing = false;
  }
}

/** For tests. */
export function _resetAnalytics(): void {
  mode = 'pending';
  transport = null;
  events = [];
  impressions = [];
  seenThisSession.clear();
  debugSink = null;
}

export function _bufferSizes() {
  return { events: events.length, impressions: impressions.length };
}

/** Default transport: our first-party aggregate endpoint. */
export function httpTransport(apiUrl: string, fetchImpl: typeof fetch = fetch): Transport {
  const post = async (path: string, body: unknown) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      await fetchImpl(`${apiUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };
  return {
    sendEvents: (evs) => post('/v1/events', { events: evs }),
    sendImpressions: (ids) => post('/v1/impressions', { offerIds: ids }),
  };
}
