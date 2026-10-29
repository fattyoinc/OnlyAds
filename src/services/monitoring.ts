/**
 * Error monitoring with privacy safeguards. Every message is scrubbed before it
 * is stored or forwarded: URLs lose their query strings, coordinates, emails,
 * long tokens and promo codes are redacted. By default errors go to an in-memory
 * ring buffer (visible in Profile → Diagnostics) and the dev console.
 *
 * To use a crash-reporting service (e.g. Sentry), call setErrorSink() at startup
 * with a function that forwards the already-scrubbed report. See docs/OPERATIONS.md.
 */

import { track } from './analytics';

export interface ErrorReport {
  at: string;
  message: string;
  context?: string;
  fatal?: boolean;
}

const RING_SIZE = 20;
const ring: ErrorReport[] = [];
let sink: ((r: ErrorReport) => void) | null = null;

export function scrub(input: string): string {
  return (
    input
      // query strings and fragments in URLs
      .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/gi, '$1?…')
      // emails
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      // lat/lng-looking pairs and long decimals
      .replace(/-?\d{1,3}\.\d{3,}/g, '[num]')
      // bearer tokens / long opaque strings
      .replace(/\b(bearer\s+)?[A-Za-z0-9_\-]{32,}\b/gi, '[token]')
      .slice(0, 500)
  );
}

export function setErrorSink(fn: ((r: ErrorReport) => void) | null): void {
  sink = fn;
}

export function reportError(err: unknown, context?: string, fatal = false): void {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const report: ErrorReport = { at: new Date().toISOString(), message: scrub(raw), context, fatal };
  ring.push(report);
  // Product metrics get the error *category* only, never the message.
  if (context) track('error', { context: context.replace(/[^a-z0-9_:+-]/gi, '_').slice(0, 32) });
  if (ring.length > RING_SIZE) ring.shift();
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[onlyads]', context ?? '', report.message);
  try {
    sink?.(report);
  } catch {
    // never let monitoring crash the app
  }
}

export function recentErrors(): readonly ErrorReport[] {
  return ring;
}

/** Route uncaught JS errors through reportError (native only; web uses window.onerror). */
export function installGlobalHandler(): void {
  const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } };
  const EU = g.ErrorUtils;
  if (!EU) return;
  const previous = EU.getGlobalHandler();
  EU.setGlobalHandler((e, fatal) => {
    reportError(e, 'uncaught', !!fatal);
    previous(e, fatal);
  });
}
